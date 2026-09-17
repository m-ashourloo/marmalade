import { describe, expect, it } from 'vitest'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { buildPageIndex, findMatches, normalize, rawOffsetToItem, snippet } from './normalize'

const OPTS = { caseSensitive: false, matchDiacritics: false }

function items(...strs: (string | [string, boolean])[]): TextItem[] {
  return strs.map((s) => {
    const [str, hasEOL] = Array.isArray(s) ? s : [s, false]
    return { str, hasEOL, dir: 'ltr', width: 0, height: 0, transform: [1, 0, 0, 1, 0, 0], fontName: 'f' } as TextItem
  })
}

describe('normalize', () => {
  it('maps every normalised character back to a raw index', () => {
    const { text, offsets } = normalize('Hello  World', OPTS)
    expect(text).toBe('hello world')
    expect(offsets).toHaveLength(text.length)
    // 'w' of world is at raw index 7 ("Hello  World")
    expect(offsets[text.indexOf('world')]).toBe(7)
  })

  it('strips soft hyphens so hyphen-broken words still match', () => {
    const { text } = normalize('high­light', OPTS)
    expect(text).toBe('highlight')
  })

  it('folds diacritics by default and keeps them when asked', () => {
    expect(normalize('café', OPTS).text).toBe('cafe')
    expect(normalize('café', { caseSensitive: false, matchDiacritics: true }).text).toBe('café')
  })

  it('respects case sensitivity', () => {
    expect(normalize('ABC', { caseSensitive: true, matchDiacritics: true }).text).toBe('ABC')
  })

  it('collapses whitespace runs and does not lead with a space', () => {
    const { text } = normalize('   a \n\t b  ', OPTS)
    expect(text).toBe('a b')
  })
})

describe('findMatches across text items', () => {
  it('finds a word split across two items — the whole point of the index', () => {
    const idx = buildPageIndex(1, items('the high', 'light layer'), OPTS)
    const found = findMatches(idx, 'highlight', false)
    expect(found).toHaveLength(1)
    expect(idx.raw.slice(found[0].rawStart, found[0].rawEnd)).toBe('high' + 'light')
  })

  it('finds a match spanning an end-of-line break', () => {
    const idx = buildPageIndex(1, items(['annotation', true], 'sidebar'), OPTS)
    expect(findMatches(idx, 'annotation sidebar', false)).toHaveLength(1)
  })

  it('finds a soft-hyphenated word split across items', () => {
    const idx = buildPageIndex(1, items('doc­u', 'ment'), OPTS)
    expect(findMatches(idx, 'document', false)).toHaveLength(1)
  })

  it('returns every occurrence', () => {
    const idx = buildPageIndex(1, items('a cat, a cat, a cat'), OPTS)
    expect(findMatches(idx, 'cat', false)).toHaveLength(3)
  })

  it('honours whole-word matching', () => {
    const idx = buildPageIndex(1, items('cat concatenate cat.'), OPTS)
    expect(findMatches(idx, 'cat', false)).toHaveLength(3)
    expect(findMatches(idx, 'cat', true)).toHaveLength(2)
  })

  it('returns nothing for an empty query', () => {
    expect(findMatches(buildPageIndex(1, items('abc'), OPTS), '', false)).toHaveLength(0)
  })
})

describe('rawOffsetToItem', () => {
  it('resolves offsets to the containing item', () => {
    const idx = buildPageIndex(1, items('abc', 'defg', 'hi'), OPTS)
    expect(rawOffsetToItem(idx, 0)).toEqual({ itemIndex: 0, charOffset: 0 })
    expect(rawOffsetToItem(idx, 2)).toEqual({ itemIndex: 0, charOffset: 2 })
    expect(rawOffsetToItem(idx, 3)).toEqual({ itemIndex: 1, charOffset: 0 })
    expect(rawOffsetToItem(idx, 6)).toEqual({ itemIndex: 1, charOffset: 3 })
    expect(rawOffsetToItem(idx, 7)).toEqual({ itemIndex: 2, charOffset: 0 })
  })

  it('spans the right items for a cross-item match', () => {
    const idx = buildPageIndex(1, items('the high', 'light layer'), OPTS)
    const [m] = findMatches(idx, 'highlight', false)
    expect(rawOffsetToItem(idx, m.rawStart).itemIndex).toBe(0)
    expect(rawOffsetToItem(idx, m.rawEnd - 1).itemIndex).toBe(1)
  })
})

describe('snippet', () => {
  it('quotes the matched text with surrounding context', () => {
    const idx = buildPageIndex(1, items('the quick brown fox jumps over the lazy dog'), OPTS)
    const [m] = findMatches(idx, 'brown', false)
    const s = snippet(idx, m, 10)
    expect(s.hit).toBe('brown')
    expect(s.before).toContain('quick')
    expect(s.after).toContain('fox')
  })
})
