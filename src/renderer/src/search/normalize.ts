import type { TextItem } from 'pdfjs-dist/types/src/display/api'

/**
 * A page's text flattened for searching.
 *
 * `text` is the normalised form actually matched against. `offsets` maps every
 * character position in `text` back to a position in the *raw* concatenation of
 * the page's text items, and `itemStarts` gives the raw offset at which each text
 * item begins. Together they let a match found in normalised space be resolved to
 * (itemIndex, charOffset) pairs — which is what makes matches that span several
 * text items work at all. PDF splits text arbitrarily, so "highlight" is very
 * often stored as ["high", "light"].
 */
export interface PageIndex {
  page: number
  /** Normalised, searchable text. */
  text: string
  /** offsets[i] = index into the raw string for normalised character i. */
  offsets: number[]
  /** Raw offset where each text item starts; length === items.length. */
  itemStarts: number[]
  /** Raw concatenated text, used to produce readable snippets. */
  raw: string
}

export interface ItemPosition {
  itemIndex: number
  charOffset: number
}

const SOFT_HYPHEN = /­/

/** Concatenate a page's text items, inserting a space at end-of-line markers. */
export function flattenItems(items: TextItem[]): { raw: string; itemStarts: number[] } {
  let raw = ''
  const itemStarts: number[] = []
  for (const item of items) {
    itemStarts.push(raw.length)
    raw += item.str
    if (item.hasEOL) raw += ' '
  }
  return { raw, itemStarts }
}

/**
 * Normalise for matching while keeping a character-for-character map back to the
 * raw text. Drops soft hyphens, collapses whitespace runs to a single space and
 * optionally folds case and diacritics.
 *
 * Characters are normalised individually so that the map stays exact; NFKC on the
 * whole string could change length in ways the map could not represent.
 */
export function normalize(
  raw: string,
  opts: { caseSensitive: boolean; matchDiacritics: boolean }
): { text: string; offsets: number[] } {
  let text = ''
  const offsets: number[] = []
  let pendingSpace = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]

    if (SOFT_HYPHEN.test(ch)) continue

    if (/\s/.test(ch)) {
      // Collapse runs, and never lead with whitespace.
      if (text.length > 0) pendingSpace = true
      continue
    }

    if (pendingSpace) {
      text += ' '
      offsets.push(i)
      pendingSpace = false
    }

    let out = ch.normalize('NFKC')
    if (!opts.matchDiacritics) {
      out = out.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    }
    if (!opts.caseSensitive) out = out.toLowerCase()

    // A single source character can expand (e.g. ﬁ -> fi). Every produced
    // character maps back to the same raw index, which keeps the map total.
    if (out.length === 0) out = ch
    for (const c of out) {
      text += c
      offsets.push(i)
    }
  }

  return { text, offsets }
}

export function buildPageIndex(
  page: number,
  items: TextItem[],
  opts: { caseSensitive: boolean; matchDiacritics: boolean }
): PageIndex {
  const { raw, itemStarts } = flattenItems(items)
  return buildIndexFromRaw(page, raw, itemStarts, opts)
}

/**
 * Rebuild an index from cached raw text. Normalisation depends on the current
 * search options, so it is always redone here — only the expensive part (pulling
 * text out of the PDF) is cached.
 */
export function buildIndexFromRaw(
  page: number,
  raw: string,
  itemStarts: number[],
  opts: { caseSensitive: boolean; matchDiacritics: boolean }
): PageIndex {
  const { text, offsets } = normalize(raw, opts)
  return { page, text, offsets, itemStarts, raw }
}

/** Resolve a raw character offset to the text item containing it. */
export function rawOffsetToItem(index: PageIndex, rawOffset: number): ItemPosition {
  // itemStarts is ascending — binary search for the last start <= rawOffset.
  let lo = 0
  let hi = index.itemStarts.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (index.itemStarts[mid] <= rawOffset) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return { itemIndex: found, charOffset: rawOffset - index.itemStarts[found] }
}

export interface RawMatch {
  /** Inclusive raw offset of the first matched character. */
  rawStart: number
  /** Exclusive raw offset just past the last matched character. */
  rawEnd: number
  normStart: number
  normEnd: number
}

/**
 * Find every occurrence of `query` in a page index. `query` must already be
 * normalised with the same options used to build the index.
 */
export function findMatches(index: PageIndex, query: string, wholeWord: boolean): RawMatch[] {
  if (query.length === 0) return []
  const matches: RawMatch[] = []
  let from = 0

  for (;;) {
    const at = index.text.indexOf(query, from)
    if (at === -1) break
    const end = at + query.length

    if (!wholeWord || isWordBoundary(index.text, at, end)) {
      matches.push({
        normStart: at,
        normEnd: end,
        rawStart: index.offsets[at],
        // The last matched character's raw index, plus one.
        rawEnd: index.offsets[end - 1] + 1
      })
    }
    from = at + 1
  }
  return matches
}

function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : text[start - 1]
  const after = end >= text.length ? '' : text[end]
  const isWord = (c: string): boolean => c !== '' && /[\p{L}\p{N}_]/u.test(c)
  return !isWord(before) && !isWord(after)
}

/** A short readable excerpt around a match, for the results list. */
export function snippet(
  index: PageIndex,
  match: RawMatch,
  radius = 42
): { before: string; hit: string; after: string } {
  const start = Math.max(0, match.rawStart - radius)
  const end = Math.min(index.raw.length, match.rawEnd + radius)
  return {
    before: (start > 0 ? '…' : '') + index.raw.slice(start, match.rawStart),
    hit: index.raw.slice(match.rawStart, match.rawEnd),
    after: index.raw.slice(match.rawEnd, end) + (end < index.raw.length ? '…' : '')
  }
}
