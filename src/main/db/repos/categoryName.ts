/** The spelling rule for a category name. Its own module, importing nothing, so
 *  the unit tests can reach it without loading better-sqlite3 — which segfaults
 *  on the host Node that vitest runs under. */

/** Longest name that still fits a rail row beside its count without wrapping. */
const MAX_NAME = 48

export function normalizeCategoryName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}
