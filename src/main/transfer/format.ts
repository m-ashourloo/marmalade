import { z } from 'zod'
import type {
  AnnotationBundle,
  BundleHighlight,
  DocumentRow,
  Highlight
} from '../../shared/types'

// Pure: no database, no node: imports. Kept that way so the format can be unit
// tested on the host Node, where better-sqlite3 segfaults.

export const BUNDLE_FORMAT = 'marmalade-annotations'
export const BUNDLE_VERSION = 1

const zNormRect = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number()
})

const zBundleHighlight = z.object({
  page: z.number().int().positive(),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'orange']),
  rects: z.array(zNormRect).min(1).max(2000),
  quotedText: z.string().max(100_000),
  textStart: z.number().int().nonnegative().nullable().default(null),
  textEnd: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  note: z.string().max(200_000).nullable().default(null)
})

export const zBundle = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  exportedAt: z.number().int().nonnegative(),
  document: z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'not a sha-256 digest'),
    fileName: z.string().max(4096),
    title: z.string().max(2000).nullable().default(null),
    author: z.string().max(2000).nullable().default(null),
    pageCount: z.number().int().nonnegative()
  }),
  highlights: z.array(zBundleHighlight).max(100_000)
})

export function buildBundle(doc: DocumentRow, highlights: Highlight[]): AnnotationBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    document: {
      sha256: doc.sha256,
      fileName: doc.path.split(/[\\/]/).pop() ?? '',
      title: doc.title,
      author: doc.author,
      pageCount: doc.pageCount
    },
    highlights: highlights.map(
      (h): BundleHighlight => ({
        page: h.page,
        color: h.color,
        rects: h.rects,
        quotedText: h.quotedText,
        textStart: h.textStart,
        textEnd: h.textEnd,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
        note: h.note
      })
    )
  }
}

/**
 * Parse and validate an import file. Throws a message meant to be shown to the
 * user — the modal surfaces it verbatim.
 */
export function parseBundle(text: string): AnnotationBundle {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  // Checked before the full parse so a plain .json gets a useful message rather
  // than a wall of zod issues.
  const shape = json as { format?: unknown; version?: unknown }
  if (shape?.format !== BUNDLE_FORMAT) {
    throw new Error('That file is not a Marmalade annotations export.')
  }
  if (shape?.version !== BUNDLE_VERSION) {
    throw new Error(
      `This export was written by a newer version of Marmalade (format ${String(shape?.version)}).`
    )
  }

  const parsed = zBundle.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Malformed export: ${first.path.join('.') || 'root'} — ${first.message}`)
  }
  return parsed.data
}

/**
 * Identity of a highlight for merge purposes. Rects are rounded because they
 * survive a JSON round trip exactly but a re-export from a different build might
 * not, and a pixel of drift should not create a duplicate.
 */
export function dedupeKey(h: Pick<BundleHighlight, 'page' | 'color' | 'rects'>): string {
  const rects = h.rects
    .map((r) => [r.x0, r.y0, r.x1, r.y1].map((n) => n.toFixed(4)).join(','))
    .join(';')
  return `${h.page}|${h.color}|${rects}`
}

/** Characters Windows forbids in a file name. */
const RESERVED = String.raw`<>:"/\|?*`

/**
 * Default name offered by the save dialog. Windows rejects several characters
 * outright, and a PDF title is free text that routinely contains them.
 */
export function exportFileName(title: string, ext: string): string {
  const cleaned = [...title]
    .filter((ch) => !RESERVED.includes(ch) && ch.codePointAt(0)! > 0x1f)
    .join('')
    // Windows also refuses a name ending in a dot or a space.
    .replace(/[. ]+$/, '')
    .trim()
  return `${cleaned === '' ? 'annotations' : cleaned.slice(0, 120)}.${ext}`
}
