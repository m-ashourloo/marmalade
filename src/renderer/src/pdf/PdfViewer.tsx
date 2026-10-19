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
import type { LinkTarget } from './links'
import { COLOR_LABEL, SWATCH } from '../theme/colors'
import { clampZoom, wheelZoomFactor } from './zoom'
import type { HighlightColor as HC } from '@shared/types'

/** Pages kept mounted on either side of the viewport. Each A4 canvas at 1.5x on a
 *  2x display is ~35 MB, so this window is a memory budget, not a nicety. */
const OVERSCAN = 1
const PAGE_GAP = 16
/** Quiet time after the last Ctrl+wheel event before the zoom is committed. A
 *  pinch delivers ~60 events a second, and every commit re-rasterises the
 *  mounted pages, so committing per event would flash them blank throughout. */
const WHEEL_SETTLE_MS = 120

/**
 * Scaling the content down shrinks the scroller's overflow, and Chromium then
 * clamps scrollLeft/scrollTop mid-gesture, shoving the page sideways. Holding
 * the pre-gesture extent open with an empty sized box stops that.
 */
function holdExtent(
  spacer: HTMLDivElement | null,
  size: { width: number; height: number } | null
): void {
  if (!spacer) return
  spacer.style.width = size ? `${size.width}px` : '0'
  spacer.style.height = size ? `${size.height}px` : '0'
}

export interface ViewerHandle {
  scrollToPage: (page: number, yFraction?: number) => void
  scrollToRect: (page: number, rect: NormRect) => void
  /** Where the reader is, page-relative, so it can be returned to after a zoom. */
  getAnchor: () => { page: number; within: number }
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
  onLinkClick: (target: LinkTarget) => void
  onPositionChange: (page: number, scrollFraction: number) => void
  /** Ctrl+wheel / pinch asked for this scale; the caller clamps and applies it. */
  onZoom: (scale: number) => void
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
  onLinkClick,
  onPositionChange,
  onZoom,
  handleRef
}: PdfViewerProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewportsRef = useRef<Map<number, PageViewport>>(new Map())
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  /** Where the reader currently is, in page-relative terms rather than pixels. */
  const anchorRef = useRef({ page: 1, within: 0 })
  /** The scroll position a Ctrl+wheel zoom's preview promised, for the re-anchor to apply. */
  const wheelFocusRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

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
    const focus = wheelFocusRef.current
    wheelFocusRef.current = null
    // Dropped in the same pre-paint pass that re-lays out the pages, so the
    // preview hands over to the real render without a frame of either jump.
    if (contentRef.current) contentRef.current.style.transform = ''
    holdExtent(spacerRef.current, null)
    if (focus) {
      // A wheel zoom lands exactly where its preview showed it.
      el.scrollTop = focus.scrollTop
      el.scrollLeft = focus.scrollLeft
      return
    }
    const { page, within } = anchorRef.current
    const i = Math.max(0, Math.min(numPages - 1, page - 1))
    el.scrollTop = layout.tops[i] + layout.heights[i] * within
  }, [scale, rotation, layout, numPages])

  // ---- Ctrl+wheel and touchpad pinch ---------------------------------------
  const latest = useRef({ scale, layout, swap, pageSizes: doc.pageSizes, onZoom })
  latest.current = { scale, layout, swap, pageSizes: doc.pageSizes, onZoom }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let gesture: {
      target: number
      from: number
      /** The page under the cursor, and where on it — fixed for the whole gesture. */
      page: number
      within: number
      inPageX: number
      /** Cursor position in content coordinates, and in the scroller's viewport. */
      x: number
      y: number
      offsetX: number
      offsetY: number
      scrollLeft: number
      scrollTop: number
      padTop: number
      padBottom: number
      timer: number
    } | null = null

    /**
     * Where a zoom to `target` will leave the view once the real layout lands:
     * the cursor's point pinned where possible, but with narrow pages centred and
     * the scroll offsets clamped, exactly as the browser will clamp them. The
     * preview is drawn to match this, so the commit has nothing left to move.
     */
    const plan = (g: NonNullable<typeof gesture>, target: number) => {
      const { layout: lay, swap: swapped, pageSizes } = latest.current
      const content = contentRef.current
      const viewW = content?.clientWidth ?? el.clientWidth
      const k = target / g.from
      const n = lay.tops.length
      const i = g.page
      // Page gaps are fixed pixels, so only the page heights scale.
      const top = (lay.tops[i] - i * PAGE_GAP) * k + i * PAGE_GAP
      const total = (lay.total - n * PAGE_GAP) * k + n * PAGE_GAP
      const newY = top + lay.heights[i] * k * g.within

      const widthOf = (p: number, s: number): number =>
        (swapped ? pageSizes[p].height : pageSizes[p].width) * s
      const widest = Math.max(...pageSizes.map((_, p) => widthOf(p, target)))
      const newX = Math.max(0, (viewW - widthOf(i, target)) / 2) + g.inPageX * k

      const clamp = (v: number, max: number): number => Math.max(0, Math.min(Math.max(0, max), v))
      const scrollTop = clamp(
        g.padTop + newY - g.offsetY,
        g.padTop + total + g.padBottom - el.clientHeight
      )
      const scrollLeft = clamp(newX - g.offsetX, widest - viewW)
      return {
        scrollLeft,
        scrollTop,
        // translate(tx, ty) scale(k) about the content's origin, chosen so the
        // cursor's point sits on screen where the committed layout will put it.
        tx: newX - scrollLeft + g.scrollLeft - g.x * k,
        ty: newY - scrollTop + g.scrollTop - g.y * k
      }
    }

    const commit = (): void => {
      const g = gesture
      gesture = null
      const content = contentRef.current
      if (!g || !content) return
      if (Math.abs(g.target - latest.current.scale) < 1e-3) {
        content.style.transform = ''
        holdExtent(spacerRef.current, null)
        return
      }
      const { scrollLeft, scrollTop } = plan(g, g.target)
      wheelFocusRef.current = { scrollLeft, scrollTop }
      latest.current.onZoom(g.target)
    }

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      // Without this Chromium zooms the entire window, toolbar and all.
      e.preventDefault()
      const content = contentRef.current
      if (!content) return

      if (!gesture) {
        const { scale: from, layout: lay, swap: swapped, pageSizes } = latest.current
        const box = el.getBoundingClientRect()
        const offsetX = e.clientX - box.left - el.clientLeft
        const offsetY = e.clientY - box.top - el.clientTop
        const x = el.scrollLeft + offsetX
        const y = el.scrollTop + offsetY - content.offsetTop
        const found = lay.tops.findIndex((t, k) => y < t + lay.heights[k] + PAGE_GAP)
        const page = found === -1 ? lay.tops.length - 1 : found
        const baseW = swapped ? pageSizes[page].height : pageSizes[page].width
        const pageLeft = Math.max(0, (content.clientWidth - baseW * from) / 2)
        gesture = {
          target: from,
          from,
          page,
          within: (y - lay.tops[page]) / lay.heights[page],
          inPageX: x - pageLeft,
          x,
          y,
          offsetX,
          offsetY,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
          padTop: content.offsetTop,
          padBottom: el.scrollHeight - content.offsetTop - lay.total,
          timer: 0
        }
        holdExtent(spacerRef.current, { width: el.scrollWidth, height: el.scrollHeight })
      }
      gesture.target = clampZoom(gesture.target * wheelZoomFactor(e))

      // A visual preview only: everything inside — canvas, text layer, highlight
      // overlay — scales together, so nothing drifts apart. The real re-layout
      // from normalised geometry still happens on commit.
      const { tx, ty } = plan(gesture, gesture.target)
      content.style.transformOrigin = '0 0'
      content.style.transform = `translate(${tx}px, ${ty}px) scale(${gesture.target / gesture.from})`

      window.clearTimeout(gesture.timer)
      gesture.timer = window.setTimeout(commit, WHEEL_SETTLE_MS)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (gesture) window.clearTimeout(gesture.timer)
    }
  }, [])

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
      },
      getAnchor: () => ({ ...anchorRef.current })
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
      <div ref={spacerRef} aria-hidden className="zoom-extent" />
      <div ref={contentRef} style={{ height: layout.total, position: 'relative' }}>
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
                onLinkClick={onLinkClick}
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
