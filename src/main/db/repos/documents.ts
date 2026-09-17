import { getDb } from '../connection'
import type { DocumentRow, DocumentMeta } from '../../../shared/types'

interface RawDoc {
  id: number
  path: string
  sha256: string
  file_size: number
  title: string | null
  author: string | null
  page_count: number
  last_page: number
  last_scroll: number | null
  last_zoom: number | null
  last_opened_at: number | null
  created_at: number
  missing: number
}

function toDoc(r: RawDoc): DocumentRow {
  return {
    id: r.id,
    path: r.path,
    sha256: r.sha256,
    fileSize: r.file_size,
    title: r.title,
    author: r.author,
    pageCount: r.page_count,
    lastPage: r.last_page,
    lastScroll: r.last_scroll,
    lastZoom: r.last_zoom,
    lastOpenedAt: r.last_opened_at,
    createdAt: r.created_at,
    missing: r.missing === 1
  }
}

export function listRecent(limit = 100): DocumentRow[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM documents
         ORDER BY last_opened_at DESC NULLS LAST, created_at DESC
         LIMIT ?`
      )
      .all(limit) as RawDoc[]
  ).map(toDoc)
}

export function getById(id: number): DocumentRow | null {
  const r = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as RawDoc | undefined
  return r ? toDoc(r) : null
}

export function findBySha(sha256: string): DocumentRow | null {
  const r = getDb().prepare('SELECT * FROM documents WHERE sha256 = ?').get(sha256) as
    | RawDoc
    | undefined
  return r ? toDoc(r) : null
}

/**
 * Identity is the file hash, not the path: a PDF that has been moved or renamed
 * keeps every annotation. When the hash is already known we only refresh the path.
 */
export function upsertOnOpen(input: {
  path: string
  sha256: string
  fileSize: number
  title: string | null
}): { doc: DocumentRow; isNew: boolean } {
  const db = getDb()
  const now = Date.now()
  const existing = findBySha(input.sha256)

  if (existing) {
    db.prepare(
      `UPDATE documents
         SET path = ?, file_size = ?, last_opened_at = ?, missing = 0
       WHERE id = ?`
    ).run(input.path, input.fileSize, now, existing.id)
    return { doc: getById(existing.id)!, isNew: false }
  }

  const info = db
    .prepare(
      `INSERT INTO documents (path, sha256, file_size, title, last_opened_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.path, input.sha256, input.fileSize, input.title, now, now)
  return { doc: getById(Number(info.lastInsertRowid))!, isNew: true }
}

/** Called once the renderer has parsed the document and knows its real metadata. */
export function updateMeta(id: number, meta: DocumentMeta): void {
  const db = getDb()
  if (meta.pageCount !== undefined) {
    db.prepare('UPDATE documents SET page_count = ? WHERE id = ?').run(meta.pageCount, id)
  }
  if (meta.title !== undefined && meta.title) {
    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(meta.title, id)
  }
  if (meta.author !== undefined) {
    db.prepare('UPDATE documents SET author = ? WHERE id = ?').run(meta.author, id)
  }
}

export function savePosition(
  id: number,
  pos: { page: number; scroll: number; zoom: number }
): void {
  getDb()
    .prepare(
      'UPDATE documents SET last_page = ?, last_scroll = ?, last_zoom = ?, last_opened_at = ? WHERE id = ?'
    )
    .run(pos.page, pos.scroll, pos.zoom, Date.now(), id)
}

/** A file whose path no longer resolves is flagged, never deleted — the
 *  annotations are still valuable if the file comes back. */
export function markMissing(id: number, missing: boolean): void {
  getDb().prepare('UPDATE documents SET missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
}

export function remove(id: number): void {
  getDb().prepare('DELETE FROM documents WHERE id = ?').run(id)
}
