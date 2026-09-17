import { useCallback, useEffect, useState } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import type { NormRect } from '@shared/types'
import { clientRectToPageRect, dedupeRects, viewportRectToNorm } from './geometry'

export interface PendingSelection {
  /** Per-page geometry — a selection may cross a page boundary. */
  pages: { page: number; rects: NormRect[] }[]
  text: string
  /** Where to anchor the colour popup, in client coordinates. */
  anchor: { x: number; y: number }
}

export interface SelectionSource {
  /** Live viewport for a mounted page, or null if it is not rendered. */
  getViewport: (page: number) => PageViewport | null
  getPageBox: (page: number) => number[] | null
}

/**
 * Converts a DOM text selection over the pdf.js text layers into persistable,
 * page-relative geometry.
 *
 * getClientRects() yields one rectangle per visual line fragment, which is
 * exactly the granularity a PDF highlight wants.
 */
export function useSelection(
  rootRef: React.RefObject<HTMLElement | null>,
  source: SelectionSource
): { selection: PendingSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<PendingSelection | null>(null)

  const clear = useCallback(() => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const capture = useCallback(() => {
    const sel = window.getSelection()
    const root = rootRef.current
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) {
      setSelection(null)
      return
    }

    const text = sel.toString().trim()
    if (text === '') {
      setSelection(null)
      return
    }

    // Bucket every line rect by the page container it falls inside — a selection
    // can span two pages, and each page has its own coordinate space.
    const pageEls = Array.from(root.querySelectorAll<HTMLElement>('.page'))
    const buckets = new Map<number, NormRect[]>()
    let anchor: { x: number; y: number } | null = null

    for (let r = 0; r < sel.rangeCount; r++) {
      const range = sel.getRangeAt(r)
      if (!root.contains(range.commonAncestorContainer)) continue

      for (const clientRect of Array.from(range.getClientRects())) {
        if (clientRect.width < 0.5 || clientRect.height < 0.5) continue

        const cx = clientRect.left + clientRect.width / 2
        const cy = clientRect.top + clientRect.height / 2
        const pageEl = pageEls.find((el) => {
          const b = el.getBoundingClientRect()
          return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom
        })
        if (!pageEl) continue

        const pageNumber = Number(pageEl.dataset.page)
        const viewport = source.getViewport(pageNumber)
        const box = source.getPageBox(pageNumber)
        if (!viewport || !box) continue

        const local = clientRectToPageRect(clientRect, pageEl.getBoundingClientRect())
        const norm = viewportRectToNorm(local, viewport, box)

        const list = buckets.get(pageNumber)
        if (list) list.push(norm)
        else buckets.set(pageNumber, [norm])

        if (!anchor || clientRect.top < anchor.y) {
          anchor = { x: clientRect.left + clientRect.width / 2, y: clientRect.top }
        }
      }
    }

    if (buckets.size === 0 || !anchor) {
      setSelection(null)
      return
    }

    setSelection({
      pages: Array.from(buckets.entries())
        .map(([page, rects]) => ({ page, rects: dedupeRects(rects) }))
        .filter((p) => p.rects.length > 0)
        .sort((a, b) => a.page - b.page),
      text,
      anchor
    })
  }, [rootRef, source])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // Capture on release rather than on selectionchange, so the popup does not
    // jump around while the user is still dragging.
    const onUp = (): void => {
      window.setTimeout(capture, 0)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey || e.key === 'Escape') window.setTimeout(capture, 0)
    }

    root.addEventListener('mouseup', onUp)
    root.addEventListener('keyup', onKeyUp)
    return () => {
      root.removeEventListener('mouseup', onUp)
      root.removeEventListener('keyup', onKeyUp)
    }
  }, [rootRef, capture])

  return { selection, clear }
}
