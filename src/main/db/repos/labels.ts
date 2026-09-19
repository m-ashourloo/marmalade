import { getDb } from '../connection'
import { normalizeLabel } from './labelName'
import type { LabelRow } from '../../../shared/types'

interface RawLabel {
  name: string
  use_count: number
}

function toLabelRow(r: RawLabel): LabelRow {
  return { name: r.name, useCount: r.use_count }
}

/**
 * Resolve names to label ids, creating the ones that do not exist yet. Names
 * differing only in case or spacing collapse to a single id, and the caller is
 * expected to already hold a transaction.
 */
export function ensureIds(names: string[]): number[] {
  const db = getDb()
  const wanted: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = normalizeLabel(raw)
    if (name === '') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push(name)
  }
  if (wanted.length === 0) return []

  const insert = db.prepare(
    'INSERT INTO labels (name, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
  )
  // COLLATE NOCASE matches the unique index, so an existing "TODO" is found by
  // a freshly typed "todo" instead of being inserted a second time.
  const find = db.prepare('SELECT id FROM labels WHERE name = ? COLLATE NOCASE')

  const now = Date.now()
  const ids: number[] = []
  for (const name of wanted) {
    insert.run(name, now)
    const row = find.get(name) as { id: number } | undefined
    if (row) ids.push(row.id)
  }
  return ids
}

/** The whole vocabulary, for the label picker and the sidebar filter bar. */
export function listAll(): LabelRow[] {
  return (
    getDb()
      .prepare(
        `SELECT l.name AS name, COUNT(hl.highlight_id) AS use_count
           FROM labels l
           LEFT JOIN highlight_labels hl ON hl.label_id = l.id
          GROUP BY l.id
          ORDER BY l.name COLLATE NOCASE ASC`
      )
      .all() as RawLabel[]
  ).map(toLabelRow)
}

/**
 * Drop labels no highlight carries any more. Called after every label write so
 * a typo the user corrects a second later does not sit in the picker forever.
 */
export function pruneOrphans(): void {
  getDb()
    .prepare(
      'DELETE FROM labels WHERE id NOT IN (SELECT label_id FROM highlight_labels)'
    )
    .run()
}
