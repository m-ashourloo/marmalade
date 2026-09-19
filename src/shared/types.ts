// Type-only module shared by main, preload and renderer.
// MUST NOT import anything from node: — the renderer is sandboxed.

/** Semantic highlight colour key. Resolved to RGBA at render time so that dark
 *  mode can remap colours without rewriting stored data. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange']

/** A rectangle normalised to 0..1 against the page's crop box, origin bottom-left
 *  (PDF user space convention). Survives zoom, rotation and DPI changes. */
export interface NormRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface DocumentRow {
  id: number
  path: string
  sha256: string
  fileSize: number
  title: string | null
  author: string | null
  pageCount: number
  lastPage: number
  lastScroll: number | null
  lastZoom: number | null
  lastOpenedAt: number | null
  createdAt: number
  missing: boolean
  /** Only populated by library:list — the reader does not need it. */
  highlightCount?: number
}

export interface Highlight {
  id: number
  docId: number
  page: number
  /** Shared by every page-part of one cross-page selection; null when the
   *  highlight stands alone. */
  groupId: string | null
  color: HighlightColor
  rects: NormRect[]
  quotedText: string
  textStart: number | null
  textEnd: number | null
  createdAt: number
  updatedAt: number
  /** Body of the attached note, or null when the highlight has no note. */
  note: string | null
  /** Label names, sorted, case-insensitively unique. Empty rather than null so
   *  the renderer never has to branch on absence. */
  labels: string[]
}

/** An entry in the library-wide label vocabulary, with how many highlight rows
 *  carry it — a cross-page selection therefore counts once per page-part. */
export interface LabelRow {
  name: string
  useCount: number
}

/** One page's share of a selection: the rects that fell on that page. */
export interface HighlightPart {
  page: number
  rects: NormRect[]
}

/** A selection as the renderer captures it. One part per page it touched — the
 *  main process turns the parts into rows sharing a group id. */
export interface NewHighlightGroup {
  docId: number
  color: HighlightColor
  quotedText: string
  parts: HighlightPart[]
}

export interface NewHighlight {
  docId: number
  page: number
  color: HighlightColor
  rects: NormRect[]
  quotedText: string
  textStart?: number | null
  textEnd?: number | null
}

export interface HighlightPatch {
  color?: HighlightColor
  rects?: NormRect[]
}

export interface DocumentMeta {
  pageCount?: number
  title?: string | null
  author?: string | null
}

/** Reading appearance settings, persisted in the settings table. */
export type ReadingMode = 'normal' | 'dark' | 'sepia'

export interface ReadingPrefs {
  mode: ReadingMode
  /** brightness() multiplier applied to the page canvas, 0.55..1 */
  dim: number
  /** sepia() amount applied to the page canvas, 0..0.6 */
  warmth: number
  /** UI chrome theme, independent of the page filter. */
  uiTheme: 'light' | 'dark'
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  mode: 'normal',
  dim: 1,
  warmth: 0,
  uiTheme: 'dark'
}

/** Cached, normalised page text used by the search index. */
export interface PageTextRow {
  page: number
  text: string
  offsets: number[]
}

/** A cached render of the page a document was last left on, for the library. */
export interface ThumbnailRow {
  page: number
  width: number
  height: number
  image: ArrayBuffer
}

export interface OpenedDocument {
  doc: DocumentRow
  /** True when this document had never been opened before. */
  isNew: boolean
}

// ---------------------------------------------------------------- transfer

/** A highlight as it travels in a .mmnotes.json bundle: no ids, since document
 *  and highlight rowids are local to whichever library wrote the file. */
export interface BundleHighlight {
  page: number
  groupId: string | null
  color: HighlightColor
  rects: NormRect[]
  quotedText: string
  textStart: number | null
  textEnd: number | null
  createdAt: number
  updatedAt: number
  note: string | null
  labels: string[]
}

export interface AnnotationBundle {
  format: 'marmalade-annotations'
  version: 1
  exportedAt: number
  document: {
    sha256: string
    fileName: string
    title: string | null
    author: string | null
    pageCount: number
  }
  highlights: BundleHighlight[]
}

/** The result of parsing an import file without writing anything. */
export interface ImportPreview {
  document: AnnotationBundle['document']
  highlightCount: number
  noteCount: number
  /** Resolved by SHA-256 against the library. */
  match: { kind: 'exact'; docId: number; title: string } | { kind: 'none' }
}

export interface ImportResult {
  docId: number
  added: number
  skippedDuplicate: number
  skippedOutOfRange: number
  notesAdded: number
}

export interface ExportResult {
  saved: boolean
  path: string | null
  count: number
}
