import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import * as labels from './labels'
import { dedupeKey } from '../../transfer/format'
import type {
  BundleHighlight,
  Highlight,
  HighlightColor,
  HighlightPatch,
  ImportResult,
  NewHighlight,
  NewHighlightGroup,
  NormRect
} from '../../../shared/types'

interface RawHighlight {
  id: number
  doc_id: number
  page: number
  group_id: string | null
  color: string
  rects: string
  quoted_text: string
  text_start: number | null
  text_end: number | null
  created_at: number
  updated_at: number
  note: string | null
  labels: string
}

function toHighlight(r: RawHighlight): Highlight {
  return {
    id: r.id,
    docId: r.doc_id,
    page: r.page,
    groupId: r.group_id,
    color: r.color as HighlightColor,
    rects: JSON.parse(r.rects) as NormRect[],
    quotedText: r.quoted_text,
    textStart: r.text_start,
    textEnd: r.text_end,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    note: r.note,
    labels: JSON.parse(r.labels) as string[]
  }
}

// The label subquery is ordered in an inner SELECT rather than by the aggregate,
// so the JSON array comes back sorted and the renderer can render it as-is.
const SELECT_WITH_NOTE = `
  SELECT h.*,
         n.body AS note,
         (SELECT json_group_array(name) FROM (
            SELECT l.name FROM highlight_labels hl
              JOIN labels l ON l.id = hl.label_id
             WHERE hl.highlight_id = h.id
             ORDER BY l.name COLLATE NOCASE)) AS labels
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

const INSERT_SQL = `
  INSERT INTO highlights
    (doc_id, page, group_id, color, rects, quoted_text, text_start, text_end, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

export function create(input: NewHighlight): Highlight {
  const now = Date.now()
  const info = getDb()
    .prepare(INSERT_SQL)
    .run(
      input.docId,
      input.page,
      null,
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

/**
 * Writes one selection. Geometry stays split per page — rects are normalised
 * against a single page's crop box — but every row of a multi-page selection
 * shares a group id so the UI can treat them as one highlight. A single-page
 * selection keeps a NULL group: it is already its own group.
 */
export function createGroup(input: NewHighlightGroup): Highlight[] {
  const db = getDb()
  const now = Date.now()
  const groupId = input.parts.length > 1 ? randomUUID() : null
  const insert = db.prepare(INSERT_SQL)

  const ids = db.transaction(() =>
    [...input.parts]
      .sort((a, b) => a.page - b.page)
      .map((part) =>
        Number(
          insert.run(
            input.docId,
            part.page,
            groupId,
            input.color,
            JSON.stringify(part.rects),
            input.quotedText,
            null,
            null,
            now,
            now
          ).lastInsertRowid
        )
      )
  )()

  return ids.map((id) => getById(id)!)
}

/**
 * Every row belonging to the same selection as `id`, page-ascending. A NULL
 * group is a group of one, so this always returns at least the row itself.
 */
function memberIds(id: number): number[] {
  const db = getDb()
  const row = db.prepare('SELECT doc_id, group_id FROM highlights WHERE id = ?').get(id) as
    | { doc_id: number; group_id: string | null }
    | undefined
  if (!row) return []
  if (row.group_id === null) return [id]
  return (
    db
      .prepare(
        'SELECT id FROM highlights WHERE doc_id = ? AND group_id = ? ORDER BY page ASC, id ASC'
      )
      .all(row.doc_id, row.group_id) as { id: number }[]
  ).map((r) => r.id)
}

/**
 * Recolours the whole group — the halves of one selection must never drift
 * apart. Rects stay row-local: each page's geometry is its own.
 */
export function update(id: number, patch: HighlightPatch): Highlight[] {
  const db = getDb()
  const ids = memberIds(id)
  if (ids.length === 0) return []

  const now = Date.now()
  db.transaction(() => {
    if (patch.color !== undefined) {
      const stmt = db.prepare('UPDATE highlights SET color = ?, updated_at = ? WHERE id = ?')
      for (const memberId of ids) stmt.run(patch.color, now, memberId)
    }
    if (patch.rects !== undefined) {
      db.prepare('UPDATE highlights SET rects = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(patch.rects),
        now,
        id
      )
    }
  })()
  return ids.map((memberId) => getById(memberId)).filter((h): h is Highlight => h !== null)
}

/** Deletes every page-part of the selection, returning the ids that went. */
export function remove(id: number): number[] {
  const db = getDb()
  const ids = memberIds(id)
  if (ids.length === 0) return []
  const stmt = db.prepare('DELETE FROM highlights WHERE id = ?')
  db.transaction(() => {
    for (const memberId of ids) stmt.run(memberId)
  })()
  return ids
}

/**
 * Writes, clears or replaces the note on a selection. The body is mirrored onto
 * every page-part: the notes table is keyed one-to-one by highlight id, so this
 * is what keeps a cross-page highlight showing the same note on either page —
 * in its hover tooltip and in an export bundle alike.
 */
export function upsertNote(highlightId: number, body: string): Highlight[] {
  const db = getDb()
  const ids = memberIds(highlightId)
  if (ids.length === 0) return []

  const now = Date.now()
  const del = db.prepare('DELETE FROM notes WHERE highlight_id = ?')
  const put = db.prepare(
    `INSERT INTO notes (doc_id, highlight_id, page, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(highlight_id) WHERE highlight_id IS NOT NULL
       DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
  )
  const touch = db.prepare('UPDATE highlights SET updated_at = ? WHERE id = ?')
  const info = db.prepare('SELECT doc_id, page FROM highlights WHERE id = ?')

  db.transaction(() => {
    for (const id of ids) {
      const hl = info.get(id) as { doc_id: number; page: number } | undefined
      if (!hl) continue
      if (body.trim() === '') del.run(id)
      else put.run(hl.doc_id, id, hl.page, body, now, now)
      touch.run(now, id)
    }
  })()
  return ids.map((id) => getById(id)).filter((h): h is Highlight => h !== null)
}

/**
 * Replaces the whole label set on a selection. Like the note body the set is
 * mirrored onto every page-part, so a cross-page highlight carries the same
 * labels whichever page it is read from. Passing [] clears it.
 */
export function setLabels(highlightId: number, names: string[]): Highlight[] {
  const db = getDb()
  const ids = memberIds(highlightId)
  if (ids.length === 0) return []

  const now = Date.now()
  const clear = db.prepare('DELETE FROM highlight_labels WHERE highlight_id = ?')
  const link = db.prepare(
    'INSERT INTO highlight_labels (highlight_id, label_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  )
  const touch = db.prepare('UPDATE highlights SET updated_at = ? WHERE id = ?')

  db.transaction(() => {
    const labelIds = labels.ensureIds(names)
    for (const id of ids) {
      clear.run(id)
      for (const labelId of labelIds) link.run(id, labelId)
      touch.run(now, id)
    }
    // After the clear, a label this selection was the last holder of is dead.
    labels.pruneOrphans()
  })()
  return ids.map((id) => getById(id)).filter((h): h is Highlight => h !== null)
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

  const insertHl = db.prepare(INSERT_SQL)
  const insertNote = db.prepare(
    `INSERT INTO notes (doc_id, highlight_id, page, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const linkLabel = db.prepare(
    'INSERT INTO highlight_labels (highlight_id, label_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
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
        h.groupId ?? null,
        h.color,
        JSON.stringify(h.rects),
        h.quotedText,
        h.textStart,
        h.textEnd,
        h.createdAt,
        h.updatedAt
      )
      result.added++

      for (const labelId of labels.ensureIds(h.labels)) {
        linkLabel.run(Number(info.lastInsertRowid), labelId)
      }

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
