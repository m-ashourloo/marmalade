/**
 * Node fallback for scripts/make-fixtures.py, which needs reportlab — not
 * installable on a machine whose Python has no pip. Emits the same sample.pdf
 * the harnesses assert against: 60 A4 pages, one unique marker per page, and a
 * two-level bookmark outline.
 *
 *   node scripts/make-fixtures.mjs <out-dir>
 *
 * Writes uncompressed PDF by hand rather than pulling in a PDF library, since
 * the only consumer is the test suite.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PAGES = 60
const W = 595.28
const H = 841.89
const BODY =
  'The quick brown fox jumps over the lazy dog. Highlighting text in a PDF ' +
  'requires mapping selection rectangles back into PDF user space. This sample ' +
  'document exists to exercise rendering, selection, search and outline ' +
  'navigation in the reader application. '

function wrap(text, width) {
  const out = []
  let line = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${w}` : w
    if (trial.length > width) {
      out.push(line)
      line = w
    } else {
      line = trial
    }
  }
  if (line) out.push(line)
  return out
}

/** Escape the three characters that terminate a PDF literal string. */
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)

function contentFor(page) {
  const section = Math.floor((page - 1) / 10) + 1
  const parts = [
    'BT /F2 16 Tf 72 ' + (H - 72).toFixed(2) + ' Td (' +
      esc(`Chapter ${section} - Section ${((page - 1) % 10) + 1}`) + ') Tj ET'
  ]
  let y = H - 110
  for (const line of wrap(BODY.repeat(3), 92)) {
    if (y < 140) break
    parts.push(`BT /F1 11 Tf 72 ${y.toFixed(2)} Td (${esc(line)}) Tj ET`)
    y -= 15
  }
  const marker = `zebra-${String(page).padStart(3, '0')}-quartz`
  parts.push(
    `BT /F1 11 Tf 72 ${(y - 20).toFixed(2)} Td (` +
      esc(`Distinctive marker for page ${page}: ${marker}.`) +
      ') Tj ET'
  )
  return parts.join('\n')
}

function build() {
  const objects = []
  /** Reserve an object number; bodies are filled in below. */
  const add = (body) => {
    objects.push(body)
    return objects.length // 1-based object numbers
  }

  // Fixed early slots so /Pages and /Outlines can be referenced before they exist.
  const catalogId = add(null)
  const pagesId = add(null)
  const outlinesId = add(null)
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const infoId = add(
    '<< /Title (Sample Technical Manual) /Author (Fixture Generator) >>'
  )

  const pageIds = []
  for (let p = 1; p <= PAGES; p++) {
    const stream = contentFor(p)
    const contentId = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
    )
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] ` +
          `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>`
      )
    )
  }

  // Outline: a chapter every ten pages, with one section entry per page beneath
  // it — scripts/smoke.mjs navigates to "Section 31" and asserts page 31.
  const chapters = []
  for (let p = 1; p <= PAGES; p += 10) {
    const kids = []
    for (let q = p; q < p + 10 && q <= PAGES; q++) kids.push({ page: q, title: `Section ${q}` })
    chapters.push({ page: p, title: `Chapter ${Math.floor((p - 1) / 10) + 1}`, kids })
  }
  const chapterIds = chapters.map(() => add(null))
  const kidIds = chapters.map((c) => c.kids.map(() => add(null)))

  chapters.forEach((ch, i) => {
    const ids = kidIds[i]
    objects[chapterIds[i] - 1 ] =
      `<< /Title (${esc(ch.title)}) /Parent ${outlinesId} 0 R ` +
      `/Dest [${pageIds[ch.page - 1]} 0 R /Fit] /Count ${ids.length} ` +
      `/First ${ids[0]} 0 R /Last ${ids[ids.length - 1]} 0 R` +
      (i > 0 ? ` /Prev ${chapterIds[i - 1]} 0 R` : '') +
      (i < chapters.length - 1 ? ` /Next ${chapterIds[i + 1]} 0 R` : '') +
      ' >>'
    ch.kids.forEach((kid, j) => {
      objects[ids[j] - 1] =
        `<< /Title (${esc(kid.title)}) /Parent ${chapterIds[i]} 0 R ` +
        `/Dest [${pageIds[kid.page - 1]} 0 R /Fit]` +
        (j > 0 ? ` /Prev ${ids[j - 1]} 0 R` : '') +
        (j < ids.length - 1 ? ` /Next ${ids[j + 1]} 0 R` : '') +
        ' >>'
    })
  })

  objects[catalogId - 1] =
    `<< /Type /Catalog /Pages ${pagesId} 0 R /Outlines ${outlinesId} 0 R /PageMode /UseOutlines >>`
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${PAGES} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`
  objects[outlinesId - 1] =
    `<< /Type /Outlines /Count ${chapters.length} ` +
    `/First ${chapterIds[0]} 0 R /Last ${chapterIds[chapterIds.length - 1]} 0 R >>`

  // Serialise, recording each object's byte offset for the xref table.
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const out = resolve(process.argv[2] ?? 'fixtures')
mkdirSync(out, { recursive: true })
const file = join(out, 'sample.pdf')
writeFileSync(file, build())
console.log(`wrote ${file} (${PAGES} pages)`)
