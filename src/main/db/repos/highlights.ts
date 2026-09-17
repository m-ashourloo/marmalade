import { getDb } from '../connection'
import { dedupeKey } from '../../transfer/format'
import type {
  BundleHighlight,
  Highlight,
  HighlightColor,
  HighlightPatch,
  ImportResult,
  NewHighlight,
  NormRect
} from '../../../shared/types'

interface RawHighlight {
  id: number
  doc_id: number
  page: number
  color: string
  rects: string
  quoted_text: string
  text_start: number | null
  text_end: number | null
  created_at: number
  updated_at: number
  note: string | null
}

function toHighlight(r: RawHighlight): Highlight {
  return {
    id: r.id,
    docId: r.doc_id,
    page: r.page,
    color: r.color as HighlightColor,
    rects: JSON.parse(r.rects) as NormRect[],
    quotedText: r.quoted_text,
    textStart: r.text_start,
    textEnd: r.text_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    note: r.note
  }
}

const SELECT_WITH_NOTE = `
  SELECT h.*, n.body AS note
    FROM highlights h
    LEFT JOIN notes n ON n.highlight_id = h.id`

export function listByDoc(docId: number): Highlight[] {
  return (
    getDb()
      .prepare(`${SELECT_WITH_NOTE} WHERE h.doc_id = ? ORDER BY h.page ASC, h.created_at ASC`)
      .all(docId) as RawHighlight[]
  ).map(toHighlight)
}

export function getById(id: number): Highlight | null {
  const r = getDb().prepare(`${SELECT_WITH_NOTE} WHERE h.id = ?`).get(id) as
    | RawHighlight
    | undefined
  return r ? toHighlight(r) : null
}

export function create(input: NewHighlight): Highlight {
  const now = Date.now()
  const info = getDb()
    .prepare(
      `INSERT INTO highlights
         (doc_id, page, color, rects, quoted_text, text_start, text_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.docId,
      input.page,
      input.color,
      JSON.stringify(input.rects),
      input.quotedText,
      input.textStart ?? null,
      input.textEnd ?? null,
      now,
      now
    )
  return getById(Number(info.lastInsertRowid))!
}

export function update(id: number, patch: HighlightPatch): Highlight | null {
  const db = getDb()
  const sets: string[] = []
  const args: unknown[] = []
  if (patch.color !== undefined) {
    sets.push('color = ?')
    args.push(patch.color)
  }
  if (patch.rects !== undefined) {
    sets.push('rects = ?')
    args.push(JSON.stringify(patch.rects))
  }
  if (sets.length === 0) return getById(id)
  sets.push('updated_at = ?')
  args.push(Date.now(), id)
  db.prepare(`UPDATE highlights SET ${sets.join(', ')} WHERE id = ?`).run(...args)
  return getById(id)
}

export function remove(id: number): void {
  getDb().prepare('DELETE FROM highlights WHERE id = ?').run(id)
}

/** Writes, clears or replaces the single note attached to a highlight. */
export function upsertNote(highlightId: number, body: string): Highlight | null {
  const db = getDb()
  const hl = db.prepare('SELECT doc_id, page FROM highlights WHERE id = ?').get(highlightId) as
    | { doc_id: number; page: number }
    | undefined
  if (!hl) return null

  const now = Date.now()
  db.transaction(() => {
    if (body.trim() === '') {
      db.prepare('DELETE FROM notes WHERE highlight_id = ?').run(highlightId)
    } else {
      db.prepare(
        `INSERT INTO notes (doc_id, highlight_id, page, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(highlight_id) WHERE highlight_id IS NOT NULL
           DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
      ).run(hl.doc_id, highlightId, hl.page, body, now, now)
    }
    db.prepare('UPDATE highlights SET updated_at = ? WHERE id = ?').run(now, highlightId)
  })()
  return getById(highlightId)
}

/**
 * Merge imported highlights into a document. Never deletes: an incoming
 * highlight that already exists is counted and skipped, so importing the same
 * file twice is a no-op.
 *
 * Timestamps come from the bundle rather than now(), so an import preserves when
 * the reading actually happened.
 */
export function importMany(docId: number, items: BundleHighlight[]): ImportResult {
  const db = getDb()
  const result: ImportResult = {
    docId,
    added: 0,
    skippedDuplicate: 0,
    skippedOutOfRange: 0,
    notesAdded: 0
  }

  // 0 means the renderer has never reported the real count, so there is nothing
  // to range-check against and every page is allowed through.
  const pageCount =
    (db.prepare('SELECT page_count FROM documents WHERE id = ?').get(docId) as
      | { page_count: number }
      | undefined)?.page_count ?? 0

  const existing = new Set(listByDoc(docId).map(dedupeKey))

  const insertHl = db.prepare(
    `INSERT INTO highlights
       (doc_id, page, color, rects, quoted_text, text_start, text_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertNote = db.prepare(
    `INSERT INTO notes (doc_id, highlight_id, page, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  db.transaction(() => {
    for (const h of items) {
      if (pageCount > 0 && h.page > pageCount) {
        result.skippedOutOfRange++
        continue
      }
      const key = dedupeKey(h)
      if (existing.has(key)) {
        result.skippedDuplicate++
        continue
      }
      // Guards against a bundle that repeats a highlight within itself.
      existing.add(key)

      const info = insertHl.run(
        docId,
        h.page,
        h.color,
        JSON.stringify(h.rects),
        h.quotedText,
        h.textStart,
        h.textEnd,
        h.createdAt,
        h.updatedAt
      )
      result.added++

      if (h.note && h.note.trim() !== '') {
        insertNote.run(
          docId,
          Number(info.lastInsertRowid),
          h.page,
          h.note,
          h.createdAt,
          h.updatedAt
        )
        result.notesAdded++
      }
    }
  })()

  return result
}
