import { z } from 'zod'

// contextBridge does not filter arguments — every payload crossing IPC is validated
// here before it is allowed anywhere near the filesystem or SQL.

export const zId = z.number().int().positive()

export const zNormRect = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number()
})

export const zColor = z.enum(['yellow', 'green', 'blue', 'pink', 'orange'])

export const zNewHighlight = z.object({
  docId: zId,
  page: z.number().int().positive(),
  color: zColor,
  rects: z.array(zNormRect).min(1).max(2000),
  quotedText: z.string().max(100_000),
  textStart: z.number().int().nonnegative().nullable().optional(),
  textEnd: z.number().int().nonnegative().nullable().optional()
})

/** A selection's per-page parts. 64 pages is far beyond any real drag but keeps
 *  a malformed payload from fanning out into an unbounded transaction. */
export const zNewHighlightGroup = z.object({
  docId: zId,
  color: zColor,
  quotedText: z.string().max(100_000),
  parts: z
    .array(
      z.object({
        page: z.number().int().positive(),
        rects: z.array(zNormRect).min(1).max(2000)
      })
    )
    .min(1)
    .max(64)
})

export const zHighlightPatch = z.object({
  color: zColor.optional(),
  rects: z.array(zNormRect).min(1).max(2000).optional()
})

/** One label name. Normalisation (trim, case folding) happens in the repo — this
 *  is only the outer bound on what may reach it. */
export const zLabelName = z.string().min(1).max(64)

export const zLabelNames = z.array(zLabelName).max(32)

export const zPosition = z.object({
  page: z.number().int().positive(),
  scroll: z.number().min(0).max(1),
  zoom: z.number().positive().max(64)
})

export const zDocMeta = z.object({
  pageCount: z.number().int().nonnegative().optional(),
  title: z.string().max(2000).nullable().optional(),
  author: z.string().max(2000).nullable().optional()
})

export const zPageText = z.array(
  z.object({
    page: z.number().int().positive(),
    text: z.string(),
    offsets: z.array(z.number().int())
  })
)

/** A page render cached for the library screen. The byte cap is generous for a
 *  ~300px WebP but small enough that a malformed payload cannot bloat the DB. */
export const zThumbnail = z.object({
  page: z.number().int().positive(),
  width: z.number().int().positive().max(4000),
  height: z.number().int().positive().max(4000),
  image: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0 && b.byteLength <= 400_000, 'thumbnail too large')
})

export const zSettingsKey = z.string().min(1).max(100)

/** An import file's raw text. The shape inside is validated by parseBundle. */
export const zBundleText = z.string().min(2).max(32_000_000)
