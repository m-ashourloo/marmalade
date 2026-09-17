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

export const zHighlightPatch = z.object({
  color: zColor.optional(),
  rects: z.array(zNormRect).min(1).max(2000).optional()
})

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

export const zSettingsKey = z.string().min(1).max(100)

/** An import file's raw text. The shape inside is validated by parseBundle. */
export const zBundleText = z.string().min(2).max(32_000_000)
