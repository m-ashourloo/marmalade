import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadDocument } from './pdfjs'

export interface LoadedDoc {
  pdf: PDFDocumentProxy
  /** Base (scale 1, unrotated) size of every page, used for layout before render. */
  pageSizes: { width: number; height: number; view: number[]; rotate: number }[]
}

interface State {
  doc: LoadedDoc | null
  loading: boolean
  error: string | null
}

/**
 * Loads a document's bytes over IPC and parses it. The loading task is destroyed
 * on unmount — pdf.js 6 removed PDFDocumentProxy.destroy(), so tearing down via
 * the task is the only way to release the worker and its buffers.
 */
export function usePdfDocument(docId: number | null): State {
  const [state, setState] = useState<State>({ doc: null, loading: false, error: null })

  useEffect(() => {
    if (docId === null) {
      setState({ doc: null, loading: false, error: null })
      return
    }

    let cancelled = false
    let task: ReturnType<typeof loadDocument> | null = null
    setState({ doc: null, loading: true, error: null })

    void (async () => {
      try {
        const bytes = await window.api.doc.readBytes(docId)
        if (cancelled) return

        task = loadDocument(bytes)
        const pdf = await task.promise
        if (cancelled) return

        // Measure every page up front so the scroller can size placeholders
        // correctly and the scrollbar does not jump as pages render.
        const pageSizes = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_v, i) => {
            const page = await pdf.getPage(i + 1)
            const vp = page.getViewport({ scale: 1 })
            return { width: vp.width, height: vp.height, view: page.view, rotate: page.rotate }
          })
        )
        if (cancelled) return

        setState({ doc: { pdf, pageSizes }, loading: false, error: null })

        // Record real metadata now that the document is parsed.
        const meta = await pdf.getMetadata().catch(() => null)
        const info = meta?.info as { Title?: string; Author?: string } | undefined
        void window.api.doc.updateMeta(docId, {
          pageCount: pdf.numPages,
          title: info?.Title?.trim() || undefined,
          author: info?.Author?.trim() || null
        })
      } catch (err) {
        if (!cancelled) {
          setState({ doc: null, loading: false, error: (err as Error).message })
        }
      }
    })()

    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [docId])

  return state
}
