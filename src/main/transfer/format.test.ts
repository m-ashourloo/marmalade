import { describe, expect, it } from 'vitest'
import { BUNDLE_FORMAT, buildBundle, dedupeKey, exportFileName, parseBundle } from './format'
import type { DocumentRow, Highlight } from '../../shared/types'

const SHA = 'a'.repeat(64)

const doc: DocumentRow = {
  id: 1,
  path: String.raw`C:\Users\me\Documents\thesis.pdf`,
  sha256: SHA,
  fileSize: 1024,
  title: 'Thesis',
  author: 'Me',
  pageCount: 312,
  lastPage: 12,
  lastScroll: 0.3,
  lastZoom: 1.25,
  lastOpenedAt: 1757000000000,
  createdAt: 1756000000000,
  missing: false
}

const highlight: Highlight = {
  id: 7,
  docId: 1,
  page: 12,
  color: 'yellow',
  rects: [{ x0: 0.1, y0: 0.4, x1: 0.8, y1: 0.42 }],
  quotedText: 'the quoted span',
  textStart: 1040,
  textEnd: 1078,
  createdAt: 1757000000000,
  updatedAt: 1757000000001,
  note: 'my note',
}

function roundTrip(highlights: Highlight[] = [highlight]) {
  return parseBundle(JSON.stringify(buildBundle(doc, highlights)))
}

describe('buildBundle', () => {
  it('carries document identity and strips local rowids', () => {
    const b = buildBundle(doc, [highlight])
    expect(b.format).toBe(BUNDLE_FORMAT)
    expect(b.version).toBe(1)
    expect(b.document.sha256).toBe(SHA)
    expect(b.document.pageCount).toBe(312)
    expect(b.highlights[0]).not.toHaveProperty('id')
    expect(b.highlights[0]).not.toHaveProperty('docId')
  })

  it('takes the file name off a Windows path', () => {
    expect(buildBundle(doc, []).document.fileName).toBe('thesis.pdf')
  })

  it('takes the file name off a POSIX path', () => {
    const posix = { ...doc, path: '/home/me/thesis.pdf' }
    expect(buildBundle(posix, []).document.fileName).toBe('thesis.pdf')
  })
})

describe('parseBundle', () => {
  it('round-trips a highlight with its note and geometry intact', () => {
    const h = roundTrip().highlights[0]
    expect(h).toEqual({
      page: 12,
      color: 'yellow',
      rects: [{ x0: 0.1, y0: 0.4, x1: 0.8, y1: 0.42 }],
      quotedText: 'the quoted span',
      textStart: 1040,
      textEnd: 1078,
      createdAt: 1757000000000,
      updatedAt: 1757000000001,
      note: 'my note'
    })
  })

  it('preserves a null note', () => {
    expect(roundTrip([{ ...highlight, note: null }]).highlights[0].note).toBeNull()
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseBundle('not json at all')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON file that is not an export', () => {
    expect(() => parseBundle('{"hello":"world"}')).toThrow(/not a Marmalade annotations export/)
  })

  it('rejects a newer format version by name', () => {
    const b = { ...buildBundle(doc, []), version: 2 }
    expect(() => parseBundle(JSON.stringify(b))).toThrow(/newer version of Marmalade/)
  })

  it('rejects a bad sha-256', () => {
    const b = buildBundle(doc, [])
    b.document.sha256 = 'nope'
    expect(() => parseBundle(JSON.stringify(b))).toThrow(/sha-256/)
  })

  it('rejects an unknown colour rather than storing it', () => {
    const b = JSON.parse(JSON.stringify(buildBundle(doc, [highlight])))
    b.highlights[0].color = 'chartreuse'
    expect(() => parseBundle(JSON.stringify(b))).toThrow(/Malformed export/)
  })

  it('rejects page 0 — pages are 1-based', () => {
    const b = JSON.parse(JSON.stringify(buildBundle(doc, [highlight])))
    b.highlights[0].page = 0
    expect(() => parseBundle(JSON.stringify(b))).toThrow(/Malformed export/)
  })

  it('defaults the optional fields a hand-written file may omit', () => {
    const b = JSON.parse(JSON.stringify(buildBundle(doc, [highlight])))
    delete b.highlights[0].note
    delete b.highlights[0].textStart
    delete b.highlights[0].textEnd
    const h = parseBundle(JSON.stringify(b)).highlights[0]
    expect(h.note).toBeNull()
    expect(h.textStart).toBeNull()
    expect(h.textEnd).toBeNull()
  })
})

describe('dedupeKey', () => {
  it('survives a JSON round trip', () => {
    expect(dedupeKey(roundTrip().highlights[0])).toBe(dedupeKey(highlight))
  })

  it('ignores drift below 4 decimal places', () => {
    const drifted = { ...highlight, rects: [{ x0: 0.100001, y0: 0.4, x1: 0.8, y1: 0.42 }] }
    expect(dedupeKey(drifted)).toBe(dedupeKey(highlight))
  })

  it('separates highlights differing in page, colour or geometry', () => {
    const base = dedupeKey(highlight)
    expect(dedupeKey({ ...highlight, page: 13 })).not.toBe(base)
    expect(dedupeKey({ ...highlight, color: 'green' })).not.toBe(base)
    expect(dedupeKey({ ...highlight, rects: [{ x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.42 }] })).not.toBe(base)
  })

  it('distinguishes a two-rect highlight from a one-rect one', () => {
    const two = { ...highlight, rects: [...highlight.rects, { x0: 0.1, y0: 0.3, x1: 0.5, y1: 0.32 }] }
    expect(dedupeKey(two)).not.toBe(dedupeKey(highlight))
  })
})

describe('exportFileName', () => {
  it('keeps an ordinary title', () => {
    expect(exportFileName('Thesis', 'mmnotes.json')).toBe('Thesis.mmnotes.json')
  })

  it('strips the characters Windows forbids', () => {
    expect(exportFileName('Q1/Q2: notes?', 'mmnotes.json')).toBe('Q1Q2 notes.mmnotes.json')
  })

  it('strips control characters', () => {
    expect(exportFileName('a\u0007b', 'mmnotes.json')).toBe('ab.mmnotes.json')
  })

  it('refuses to end a name in a dot or a space', () => {
    expect(exportFileName('Report. ', 'mmnotes.json')).toBe('Report.mmnotes.json')
  })

  it('falls back when nothing usable is left', () => {
    expect(exportFileName('???', 'mmnotes.json')).toBe('annotations.mmnotes.json')
    expect(exportFileName('   ', 'mmnotes.json')).toBe('annotations.mmnotes.json')
  })

  it('caps a very long title', () => {
    const name = exportFileName('x'.repeat(400), 'mmnotes.json')
    expect(name).toBe(`${'x'.repeat(120)}.mmnotes.json`)
  })
})
