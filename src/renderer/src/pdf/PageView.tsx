import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { Highlight, HighlightColor, NormRect, ReadingMode } from '@shared/types'
import { TextLayer } from './pdfjs'
import { normRectToViewport } from './geometry'
import { HIGHLIGHT_FILL } from '../theme/colors'
import type { SearchHit } from '../search/types'
import { extractLinks } from './links'
import type { LinkTarget, PageLink } from './links'

/** 3x devicePixelRatio costs ~9x the memory of 1x for imperceptible gain. */
const MAX_DPR = 2

export interface PageViewProps {
  pageNumber: number
  /** Base page size at scale 1, known before the page object resolves. */
  baseSize: { width: number; height: number; view: number[] }
  scale: number
  rotation: number
  /** Null until this page is within the render window. */
  getPage: ((n: number) => Promise<PDFPageProxy>) | null
  visible: boolean
  highlights: Highlight[]
  searchHits: SearchHit[]
  currentHitId: string | null
  activeHighlightIds: ReadonlySet<number>
  mode: ReadingMode
  onHighlightClick: (id: number) => void
  onLinkClick: (target: LinkTarget) => void
  /** Publishes the live viewport so selection capture can convert coordinates. */
  onViewportReady: (pageNumber: number, viewport: PageViewport | null) => void
}

function PageViewImpl({
  pageNumber,
  baseSize,
  scale,
  rotation,
  getPage,
  visible,
  highlights,
  searchHits,
  currentHitId,
  activeHighlightIds,
  mode,
  onHighlightClick,
  onLinkClick,
  onViewportReady
}: PageViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  // State, not a ref: the overlays are laid out from the viewport during render,
  // so they must re-render once the page exists.
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [links, setLinks] = useState<PageLink[]>([])

  const swap = rotation % 180 !== 0
  const cssWidth = (swap ? baseSize.height : baseSize.width) * scale
  const cssHeight = (swap ? baseSize.width : baseSize.height) * scale

  // Derived synchronously, not in an effect: a zoom must re-lay out highlights in
  // the same commit that resizes the page, or they flash at the old scale.
  const viewport = useMemo(
    () => (page ? page.getViewport({ scale, rotation }) : null),
    [page, scale, rotation]
  )

  // ---- the page object and its links --------------------------------------
  useEffect(() => {
    if (!visible || !getPage) return
    let disposed = false
    void getPage(pageNumber).then(
      (p) => {
        if (!disposed) setPage(p)
      },
      (err) => console.error(`[PageView] page ${pageNumber} failed to load`, err)
    )
    return () => {
      disposed = true
      setPage(null)
      setLinks([])
    }
  }, [visible, getPage, pageNumber])

  useEffect(() => {
    if (!page) return
    let disposed = false
    // Not awaited by anything: links should not wait on rasterisation, nor hold it up.
    void page.getAnnotations({ intent: 'display' }).then(
      (annotations) => {
        if (!disposed) setLinks(extractLinks(annotations, baseSize.view))
      },
      (err) => console.error(`[PageView] page ${pageNumber} annotations failed`, err)
    )
    return () => {
      disposed = true
    }
  }, [page, pageNumber, baseSize.view])

  useEffect(() => {
    onViewportReady(pageNumber, viewport)
    return () => onViewportReady(pageNumber, null)
  }, [pageNumber, viewport, onViewportReady])

  // Chromium does not reclaim canvas backing stores promptly otherwise. Keyed on
  // `visible` alone, so a zoom never blanks the canvas — the old bitmap stays up,
  // stretched by its CSS size, until the new one is ready.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    return () => {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [visible])

  // The text layer is positioned from these variables, so updating them before
  // paint keeps the existing spans over their glyphs until it is rebuilt.
  useLayoutEffect(() => {
    const textDiv = textLayerRef.current
    if (!viewport || !textDiv) return
    textDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
    textDiv.style.setProperty('--scale-factor', String(viewport.scale))
    textDiv.style.width = `${Math.floor(viewport.width)}px`
    textDiv.style.height = `${Math.floor(viewport.height)}px`
  }, [viewport])

  // ---- render the canvas + text layer -------------------------------------
  useEffect(() => {
    if (!page || !viewport) return

    let disposed = false
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let textLayer: InstanceType<typeof TextLayer> | null = null
    // Rasterise off-screen and copy across in one synchronous step, so the
    // visible canvas goes straight from the old bitmap to the new one with no
    // blank frame in between.
    const scratch = document.createElement('canvas')

    void (async () => {
      const canvas = canvasRef.current
      const textDiv = textLayerRef.current
      if (!canvas || !textDiv) return

      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      scratch.width = Math.floor(viewport.width * dpr)
      scratch.height = Math.floor(viewport.height * dpr)
      const scratchCtx = scratch.getContext('2d')
      if (!scratchCtx) return

      renderTask = page.render({
        canvas: scratch,
        canvasContext: scratchCtx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      })

      try {
        await renderTask.promise
      } catch (err) {
        // Cancelling on zoom is normal; anything else is a real failure.
        if ((err as Error)?.name !== 'RenderingCancelledException') throw err
        return
      }
      if (disposed) return

      canvas.width = scratch.width
      canvas.height = scratch.height
      canvas.getContext('2d')?.drawImage(scratch, 0, 0)
      scratch.width = 0
      scratch.height = 0

      // Text layer: the TextLayer class writes CSS custom properties but no
      // font-size/transform — pdf_viewer.css supplies those, and the scale factor
      // (set in the layout effect above) must be on the container or selection
      // rects drift from the glyphs.
      textDiv.replaceChildren()
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport
      })
      await textLayer.render()
    })().catch((err) => {
      // Never swallow silently: a failed page render is invisible otherwise,
      // because the placeholder simply stays in place.
      if (!disposed) console.error(`[PageView] page ${pageNumber} failed to render`, err)
    })

    return () => {
      disposed = true
      renderTask?.cancel()
      textLayer?.cancel()
      scratch.width = 0
      scratch.height = 0
    }
  }, [page, viewport, pageNumber])

  // ---- overlay geometry ---------------------------------------------------
  // Recomputed from stored normalised coordinates on every zoom, never
  // CSS-transform-scaled, so rect edges stay crisp against re-rendered text.
  const toStyle = (r: NormRect): React.CSSProperties | null => {
    if (!viewport) return null
    const box = normRectToViewport(r, viewport, baseSize.view)
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }

  return (
    <div
      ref={containerRef}
      className="page"
      data-page={pageNumber}
      style={{ width: cssWidth, height: cssHeight }}
    >
      {visible ? (
        <>
          {/* Sized here rather than when the render lands: on a zoom the old
              bitmap stretches to the new page size in the same frame, instead
              of sitting at its old size in a resized page. */}
          <canvas
            ref={canvasRef}
            style={
              viewport
                ? { width: Math.floor(viewport.width), height: Math.floor(viewport.height) }
                : undefined
            }
          />

          <div className="search-hit-layer">
            {searchHits.map((hit) =>
              hit.rects.map((r, i) => {
                const style = toStyle(r)
                return style ? (
                  <div
                    key={`${hit.id}-${i}`}
                    className={`rect${hit.id === currentHitId ? ' current' : ''}`}
                    style={style}
                  />
                ) : null
              })
            )}
          </div>

          <div className="highlight-layer">
            {highlights.map((h) =>
              h.rects.map((r, i) => {
                const style = toStyle(r)
                return style ? (
                  <div
                    key={`${h.id}-${i}`}
                    className="rect"
                    style={{
                      ...style,
                      background: HIGHLIGHT_FILL[mode][h.color as HighlightColor],
                      outline: activeHighlightIds.has(h.id) ? '2px solid #5b9dff' : undefined
                    }}
                  />
                ) : null
              })
            )}
          </div>

          <div ref={textLayerRef} className="textLayer" />

          {/* Click targets sit ABOVE the text layer, in their own layer, so that
              clicking a highlight does not steal the text-selection gesture. */}
          <div className="hit-layer">
            {highlights.map((h) =>
              h.rects.map((r, i) => {
                const style = toStyle(r)
                return style ? (
                  <div
                    key={`hit-${h.id}-${i}`}
                    className="hit"
                    style={style}
                    title={h.note ? h.note : 'Highlight'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onHighlightClick(h.id)
                    }}
                  />
                ) : null
              })
            )}
          </div>

          {/* Above the text layer, as in pdf.js: a link wins over starting a
              selection on its text. Divs, not anchors, so nothing navigates the
              window and dragging one does not start a native link drag. */}
          <div className="link-layer">
            {links.map((link, i) => {
              const style = toStyle(link.rect)
              const url = link.target.kind === 'external' ? link.target.url : undefined
              return style ? (
                <div
                  key={`link-${i}`}
                  className="link"
                  style={style}
                  title={url}
                  data-link-kind={link.target.kind}
                  data-href={url}
                  onClick={(e) => {
                    e.stopPropagation()
                    onLinkClick(link.target)
                  }}
                />
              ) : null
            })}
          </div>
        </>
      ) : (
        <div className="placeholder">Page {pageNumber}</div>
      )}
    </div>
  )
}

export const PageView = memo(PageViewImpl)
