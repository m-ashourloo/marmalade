import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type {
  Highlight,
  HighlightColor,
  HighlightPart,
  NormRect,
  ReadingMode
} from '@shared/types'
import type { LoadedDoc } from './usePdfDocument'
import { PageView } from './PageView'
import { useSelection } from './useSelection'
import type { PendingSelection } from './useSelection'
import type { SearchHit } from '../search/types'
import { COLOR_LABEL, SWATCH } from '../theme/colors'
import type { HighlightColor as HC } from '@shared/types'

/** Pages kept mounted on either side of the viewport. Each A4 canvas at 1.5x on a
 *  2x display is ~35 MB, so this window is a memory budget, not a nicety. */
const OVERSCAN = 1
const PAGE_GAP = 16

export interface ViewerHandle {
  scrollToPage: (page: number, yFraction?: number) => void
  scrollToRect: (page: number, rect: NormRect) => void
}

export interface PdfViewerProps {
  doc: LoadedDoc
  scale: number
  rotation: number
  mode: ReadingMode
  highlightsByPage: Map<number, Highlight[]>
  searchHitsByPage: Map<number, SearchHit[]>
  currentHitId: string | null
  /** Every page-part of the selected highlight, so a cross-page one lights up whole. */
  activeHighlightIds: ReadonlySet<number>
  pendingColor: HighlightColor
  onCreateHighlight: (parts: HighlightPart[], text: string, color: HighlightColor) => void
  onHighlightClick: (id: number) => void
  onPositionChange: (page: number, scrollFraction: number) => void
  handleRef: React.RefObject<ViewerHandle | null>
}

export function PdfViewer({
  doc,
  scale,
  rotation,
  mode,
  highlightsByPage,
  searchHitsByPage,
  currentHitId,
  activeHighlightIds,
  pendingColor,
  onCreateHighlight,
  onHighlightClick,
  onPositionChange,
  handleRef
}: PdfViewerProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const viewportsRef = useRef<Map<number, PageViewport>>(new Map())
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  /** Where the reader currently is, in page-relative terms rather than pixels. */
  const anchorRef = useRef({ page: 1, within: 0 })

  const swap = rotation % 180 !== 0
  const numPages = doc.pdf.numPages

  /** Cumulative layout so the scrollbar is correct before anything has rendered. */
  const layout = useMemo(() => {
    const tops: number[] = []
    const heights: number[] = []
    let y = 0
    for (const size of doc.pageSizes) {
      const h = (swap ? size.width : size.height) * scale
      tops.push(y)
      heights.push(h)
      y += h + PAGE_GAP
    }
    return { tops, heights, total: y }
  }, [doc.pageSizes, scale, swap])

  const getPage = useCallback((n: number): Promise<PDFPageProxy> => doc.pdf.getPage(n), [doc.pdf])

  const onViewportReady = useCallback((page: number, viewport: PageViewport | null) => {
    if (viewport) viewportsRef.current.set(page, viewport)
    else viewportsRef.current.delete(page)
  }, [])

  // ---- which pages are mounted -------------------------------------------
  const recompute = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const top = el.scrollTop
    const bottom = top + el.clientHeight

    let from = numPages
    let to = 1
    for (let i = 0; i < numPages; i++) {
      const pageTop = layout.tops[i]
      const pageBottom = pageTop + layout.heights[i]
      if (pageBottom >= top && pageTop <= bottom) {
        from = Math.min(from, i + 1)
        to = Math.max(to, i + 1)
      }
    }
    if (to < from) {
      from = 1
      to = 1
    }

    setRange((prev) => {
      const next = {
        from: Math.max(1, from - OVERSCAN),
        to: Math.min(numPages, to + OVERSCAN)
      }
      return prev.from === next.from && prev.to === next.to ? prev : next
    })

    // The "current" page is the first one whose bottom is past the viewport top.
    const currentIdx = layout.tops.findIndex((t, i) => t + layout.heights[i] > top + 4)
    const page = currentIdx === -1 ? numPages : currentIdx + 1
    const within = layout.heights[page - 1]
      ? (top - layout.tops[page - 1]) / layout.heights[page - 1]
      : 0
    const clamped = Math.max(0, Math.min(1, within))
    anchorRef.current = { page, within: clamped }
    onPositionChange(page, clamped)
  }, [layout, numPages, onPositionChange])

  useEffect(() => {
    recompute()
    const el = scrollerRef.current
    if (!el) return

    // Deliberately NOT coalesced through requestAnimationFrame: rAF stops firing
    // entirely while the window is occluded or minimised, which would freeze
    // virtualisation and the page indicator until the window came back. The pass
    // is O(pages) over a plain array, so running it per scroll event is cheap.
    el.addEventListener('scroll', recompute, { passive: true })
    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', recompute)
      observer.disconnect()
    }
  }, [recompute])

  // Programmatic jumps update the mounted range immediately rather than waiting
  // for the scroll event to be delivered.
  const recomputeRef = useRef(recompute)
  recomputeRef.current = recompute

  /**
   * Keep the reader in place across zoom and rotation.
   *
   * scrollTop is measured in pixels, so rescaling the layout underneath it would
   * otherwise slide the view to an entirely different page. Restoring from the
   * page-relative anchor happens in a layout effect, before paint, so there is no
   * visible jump.
   */
  const prevScale = useRef(scale)
  const prevRotation = useRef(rotation)
  useLayoutEffect(() => {
    if (prevScale.current === scale && prevRotation.current === rotation) return
    prevScale.current = scale
    prevRotation.current = rotation

    const el = scrollerRef.current
    if (!el) return
    const { page, within } = anchorRef.current
    const i = Math.max(0, Math.min(numPages - 1, page - 1))
    el.scrollTop = layout.tops[i] + layout.heights[i] * within
  }, [scale, rotation, layout, numPages])

  // ---- imperative navigation ---------------------------------------------
  useImperativeHandle(
    handleRef,
    () => ({
      scrollToPage(page, yFraction = 0) {
        const el = scrollerRef.current
        const i = Math.max(0, Math.min(numPages - 1, page - 1))
        if (!el) return
        el.scrollTo({ top: layout.tops[i] + layout.heights[i] * yFraction })
        recomputeRef.current()
      },
      scrollToRect(page, rect) {
        const el = scrollerRef.current
        const i = Math.max(0, Math.min(numPages - 1, page - 1))
        if (!el) return
        // Normalised y is measured from the bottom of the page in PDF space.
        const fromTop = 1 - rect.y1
        const target = layout.tops[i] + layout.heights[i] * fromTop - el.clientHeight * 0.32
        // Instant, not smooth: a jump of tens of pages would otherwise animate for
        // seconds, and the pages scrolled past would all be mounted on the way.
        el.scrollTo({ top: Math.max(0, target) })
        recomputeRef.current()
      }
    }),
    [layout, numPages]
  )

  // ---- text selection -----------------------------------------------------
  const selectionSource = useMemo(
    () => ({
      getViewport: (page: number): PageViewport | null => viewportsRef.current.get(page) ?? null,
      getPageBox: (page: number): number[] | null => doc.pageSizes[page - 1]?.view ?? null
    }),
    [doc.pageSizes]
  )
  const { selection, clear } = useSelection(scrollerRef, selectionSource)

  const commit = useCallback(
    (sel: PendingSelection, color: HighlightColor) => {
      // The parts go over as one call: a selection crossing a page boundary is
      // still one highlight, written as one row per page under a shared group id.
      onCreateHighlight(sel.pages, sel.text, color)
      clear()
    },
    [onCreateHighlight, clear]
  )

  return (
    <div
      className="viewer"
      ref={scrollerRef}
      onMouseDown={(e) => {
        // Pressing anywhere else dismisses a pending selection — but not a press
        // inside the popup itself, which is rendered within this scroller.
        if (selection && !(e.target as HTMLElement).closest('.selection-popup')) clear()
      }}
    >
      <div style={{ height: layout.total, position: 'relative' }}>
        {doc.pageSizes.map((size, i) => {
          const pageNumber = i + 1
          const visible = pageNumber >= range.from && pageNumber <= range.to
          return (
            <div
              key={pageNumber}
              style={{ position: 'absolute', top: layout.tops[i], left: 0, right: 0 }}
            >
              <PageView
                pageNumber={pageNumber}
                baseSize={size}
                scale={scale}
                rotation={rotation}
                getPage={getPage}
                visible={visible}
                highlights={highlightsByPage.get(pageNumber) ?? []}
                searchHits={searchHitsByPage.get(pageNumber) ?? []}
                currentHitId={currentHitId}
                activeHighlightIds={activeHighlightIds}
                mode={mode}
                onHighlightClick={onHighlightClick}
                onViewportReady={onViewportReady}
              />
            </div>
          )
        })}
      </div>

      {selection && (
        <SelectionPopup
          selection={selection}
          defaultColor={pendingColor}
          onPick={(color) => commit(selection, color)}
        />
      )}
    </div>
  )
}

function SelectionPopup({
  selection,
  defaultColor,
  onPick
}: {
  selection: PendingSelection
  defaultColor: HighlightColor
  onPick: (color: HighlightColor) => void
}): React.JSX.Element {
  const colors = Object.keys(SWATCH) as HC[]
  const top = Math.max(8, selection.anchor.y - 48)
  const left = Math.max(8, Math.min(window.innerWidth - 220, selection.anchor.x - 100))

  return (
    <div
      className="selection-popup"
      style={{ top, left }}
      // preventDefault keeps the DOM selection alive while the popup is clicked;
      // stopPropagation keeps the scroller's dismiss handler from unmounting this
      // popup on mousedown, which would destroy the button before its click fired.
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {colors.map((c) => (
        <button
          key={c}
          className="swatch"
          style={{ background: SWATCH[c] }}
          aria-pressed={c === defaultColor}
          title={`Highlight ${COLOR_LABEL[c]}`}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}
