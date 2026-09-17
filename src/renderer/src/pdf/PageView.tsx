import { memo, useEffect, useRef, useState } from 'react'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { Highlight, HighlightColor, NormRect, ReadingMode } from '@shared/types'
import { TextLayer } from './pdfjs'
import { normRectToViewport } from './geometry'
import { HIGHLIGHT_FILL } from '../theme/colors'
import type { SearchHit } from '../search/types'

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
  activeHighlightId: number | null
  mode: ReadingMode
  onHighlightClick: (id: number) => void
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
  activeHighlightId,
  mode,
  onHighlightClick,
  onViewportReady
}: PageViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  // State, not a ref: the overlays are laid out from the viewport during render,
  // so they must re-render once it exists.
  const [viewport, setViewport] = useState<PageViewport | null>(null)

  const swap = rotation % 180 !== 0
  const cssWidth = (swap ? baseSize.height : baseSize.width) * scale
  const cssHeight = (swap ? baseSize.width : baseSize.height) * scale

  // ---- render the canvas + text layer -------------------------------------
  useEffect(() => {
    if (!visible || !getPage) return

    let disposed = false
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let textLayer: InstanceType<typeof TextLayer> | null = null

    void (async () => {
      const page = await getPage(pageNumber)
      if (disposed) return

      const viewport = page.getViewport({ scale, rotation })
      // Publish the viewport as soon as it exists, not after the canvas finishes.
      // Highlights are laid out from it, and they should reappear the moment the
      // zoom changes rather than lagging behind rasterisation.
      setViewport(viewport)
      onViewportReady(pageNumber, viewport)

      const canvas = canvasRef.current
      const textDiv = textLayerRef.current
      if (!canvas || !textDiv) return

      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      // CSS size must be set BEFORE awaiting the render, otherwise the canvas lays
      // out at its backing-store size and the scroll position snaps when it resolves.
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      renderTask = page.render({
        canvas,
        canvasContext: ctx,
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

      // Text layer: the TextLayer class writes CSS custom properties but no
      // font-size/transform — pdf_viewer.css supplies those, and the scale factor
      // must be set on the container or selection rects drift from the glyphs.
      textDiv.replaceChildren()
      textDiv.style.setProperty('--total-scale-factor', String(viewport.scale))
      textDiv.style.setProperty('--scale-factor', String(viewport.scale))
      textDiv.style.width = `${Math.floor(viewport.width)}px`
      textDiv.style.height = `${Math.floor(viewport.height)}px`

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
      setViewport(null)
      renderTask?.cancel()
      textLayer?.cancel()
      onViewportReady(pageNumber, null)
      // Chromium does not reclaim canvas backing stores promptly otherwise.
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [visible, getPage, pageNumber, scale, rotation, onViewportReady])

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
          <canvas ref={canvasRef} />

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
                      outline: h.id === activeHighlightId ? '2px solid #5b9dff' : undefined
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
        </>
      ) : (
        <div className="placeholder">Page {pageNumber}</div>
      )}
    </div>
  )
}

export const PageView = memo(PageViewImpl)
