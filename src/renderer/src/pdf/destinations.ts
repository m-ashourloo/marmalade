import type { PDFDocumentProxy } from 'pdfjs-dist'

/** A named destination, or an explicit one as pdf.js hands it over. */
export type PdfDest = string | unknown[] | null | undefined

export interface ResolvedDest {
  /** 1-based. */
  page: number
  /** Vertical position within the page, 0 (top) to 1 (bottom), if the dest gives one. */
  yFraction: number | null
}

/**
 * Resolve a destination — from an outline entry or a link annotation, which share
 * the format — to a page and scroll offset. Null when it cannot be resolved.
 */
export async function resolveDestination(
  pdf: PDFDocumentProxy,
  dest: PdfDest
): Promise<ResolvedDest | null> {
  try {
    // getDestination() still returns an array (unlike getDestinations(), which
    // became a Map in pdf.js 6).
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null

    const ref = explicit[0]
    const pageIndex =
      typeof ref === 'number'
        ? ref
        : await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    const page = pageIndex + 1
    if (page < 1 || page > pdf.numPages) return null

    // An XYZ / FitH destination carries a `top` in PDF user space.
    let yFraction: number | null = null
    const kind = (explicit[1] as { name?: string } | undefined)?.name
    const top =
      kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null
    if (typeof top === 'number') {
      const view = (await pdf.getPage(page)).view
      const height = view[3] - view[1]
      if (height > 0) yFraction = clamp01((view[3] - top) / height)
    }
    return { page, yFraction }
  } catch {
    return null
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
