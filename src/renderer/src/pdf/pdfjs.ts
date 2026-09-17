/**
 * Single owner of pdf.js global configuration.
 *
 * The worker must be wired in the same module that exposes getDocument, and this
 * module must be imported before anything else touches pdf.js — otherwise module
 * evaluation order can let the default (unset) workerSrc win. See pdf.js#19519.
 *
 * The `?worker` + workerPort form makes Vite emit a same-origin module worker, so
 * the CSP stays at `worker-src 'self'` with no blob: exception.
 */
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

// Copied next to the bundle by vite-plugin-static-copy. Without these, CJK and
// some embedded-font documents render blank glyphs.
const PDFJS_ASSETS = new URL('./pdfjs/', document.baseURI).href

export function loadDocument(data: ArrayBuffer): PDFDocumentLoadingTask {
  return pdfjsLib.getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`
  })
}

export { pdfjsLib }
export const { TextLayer, AbortException, RenderingCancelledException } = pdfjsLib
