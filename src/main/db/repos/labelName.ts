/** The spelling rule for a label name. Its own module, importing nothing, so the
 *  unit tests can reach it without loading better-sqlite3 — which segfaults on
 *  the host Node that vitest runs under. */

/** Longest name that still fits a sidebar chip without wrapping the row. */
const MAX_NAME = 64

export function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}
