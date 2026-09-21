import { getDb } from '../connection'
import { normalizeCategoryName } from './categoryName'
import type { CategoryRow } from '../../../shared/types'

interface RawCategory {
  id: number
  name: string
  doc_count: number
}

function toCategoryRow(r: RawCategory): CategoryRow {
  return { id: r.id, name: r.name, docCount: r.doc_count }
}

/** Every shelf with what is standing on it, for the rail and the move picker. */
export function listAll(): CategoryRow[] {
  return (
    getDb()
      .prepare(
        `SELECT c.id AS id, c.name AS name, COUNT(d.id) AS doc_count
           FROM categories c
           LEFT JOIN documents d ON d.category_id = c.id
          GROUP BY c.id
          ORDER BY c.name COLLATE NOCASE ASC`
      )
      .all() as RawCategory[]
  ).map(toCategoryRow)
}

/**
 * The id for a name, creating the shelf if it is new. Typing a name that already
 * exists selects it rather than failing: from the reader's side "New category:
 * Papers" when Papers exists is a request to file it there, not an error.
 * Returns null when the name normalises to nothing.
 */
export function create(rawName: string): number | null {
  const name = normalizeCategoryName(rawName)
  if (name === '') return null
  const db = getDb()
  db.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING').run(
    name,
    Date.now()
  )
  // COLLATE NOCASE matches the unique index, so an existing "Papers" is found by
  // a freshly typed "papers" instead of being inserted a second time.
  const row = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name) as
    | { id: number }
    | undefined
  return row?.id ?? null
}

export function rename(id: number, rawName: string): void {
  const name = normalizeCategoryName(rawName)
  if (name === '') return
  // Renaming onto a name that already exists would trip the unique index, and
  // silently merging two shelves is not what the reader asked for.
  getDb().prepare('UPDATE categories SET name = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?)').run(name, id, name, id)
}

/** The documents are not touched: the foreign key sets their category_id back to
 *  NULL, which puts them under Others. */
export function remove(id: number): void {
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
}

export function exists(id: number): boolean {
  return getDb().prepare('SELECT 1 FROM categories WHERE id = ?').get(id) !== undefined
}
