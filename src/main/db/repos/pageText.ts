import { getDb } from '../connection'
import type { PageTextRow } from '../../../shared/types'

/** Cached normalised page text so reopening a long book has instant search. */
export function listByDoc(docId: number): PageTextRow[] {
  const rows = getDb()
    .prepare('SELECT page, text, offsets FROM page_text WHERE doc_id = ? ORDER BY page')
    .all(docId) as { page: number; text: string; offsets: string }[]
  return rows.map((r) => ({ page: r.page, text: r.text, offsets: JSON.parse(r.offsets) }))
}

export function putMany(docId: number, pages: PageTextRow[]): void {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO page_text (doc_id, page, text, offsets) VALUES (?, ?, ?, ?)
     ON CONFLICT(doc_id, page) DO UPDATE SET text = excluded.text, offsets = excluded.offsets`
  )
  db.transaction(() => {
    for (const p of pages) stmt.run(docId, p.page, p.text, JSON.stringify(p.offsets))
  })()
}
