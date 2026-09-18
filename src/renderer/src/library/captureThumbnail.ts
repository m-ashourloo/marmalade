import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Width of the stored render. Enough for the library hero at 190px CSS on a 2x
 *  display, small enough that a WebP of it stays well inside the IPC size cap. */
const WIDTH = 400

/**
 * Cache a render of the page the reader is leaving, so the library can show the
 * page they actually stopped on rather than a filename. Failure is not worth
 * reporting — the card falls back to ruled lines — but it must stay silent,
 * because scripts/smoke.mjs fails the run on any unexpected console error.
 */
export async function captureThumbnail(
  pdf: PDFDocumentProxy,
  docId: number,
  pageNumber: number
): Promise<void> {
  try {
    const page = await pdf.getPage(pageNumber)
    const scale = WIDTH / page.getViewport({ scale: 1 }).width
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // PDFs are transparent where they are unpainted; without this the thumbnail
    // would be a black rectangle with text on it.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport, canvas }).promise

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.75)
    )
    if (!blob) return

    await window.api.doc.putThumbnail(docId, {
      page: pageNumber,
      width: canvas.width,
      height: canvas.height,
      image: new Uint8Array(await blob.arrayBuffer())
    })
  } catch {
    // Non-essential cache; the library renders fine without it.
  }
}
