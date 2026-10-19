import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DocumentRow } from '@shared/types'
import { wheelZoomFactor } from '../pdf/zoom'
import { renderMarkdown } from './render'
import { applyDirections } from './direction'

interface Props {
  doc: DocumentRow
  scale: number
  onPositionChange: (fraction: number) => void
  onOpenExternal: (url: string) => void
  onZoom: (next: number) => void
}

/** Markdown has no pages, so the position is only how far down the document the
 *  reader is, as a fraction that survives reflow. */
export function MarkdownView({
  doc,
  scale,
  onPositionChange,
  onOpenExternal,
  onZoom
}: Props): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLElement>(null)
  const fraction = useRef(doc.lastScroll ?? 0)
  // Once the reader has scrolled, late-loading images must not yank them back.
  const touched = useRef(false)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setError(null)
    fraction.current = doc.lastScroll ?? 0
    touched.current = false
    window.api.doc
      .readText(doc.id)
      .then((text) => !cancelled && setSource(text))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
    // lastScroll is read once per document, not tracked: it changes as we save it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  const html = useMemo(() => (source === null ? null : renderMarkdown(source)), [source])

  const applyFraction = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = fraction.current * Math.max(0, el.scrollHeight - el.clientHeight)
  }, [])

  // Before the scroll restore below: an RTL block can wrap to a different height.
  useLayoutEffect(() => {
    if (html !== null && bodyRef.current) applyDirections(bodyRef.current)
  }, [html])

  // Text reflows when the font size changes, so pixels would land somewhere else;
  // the fraction is what survives a zoom.
  useLayoutEffect(() => {
    if (html !== null) applyFraction()
  }, [html, scale, applyFraction])

  useEffect(() => {
    if (html !== null) scrollRef.current?.focus({ preventScroll: true })
  }, [html])

  // Images are fetched by main and handed over as blobs; until then an <img>
  // has no src at all.
  useEffect(() => {
    const body = bodyRef.current
    if (!body || html === null) return
    let cancelled = false
    const urls: string[] = []
    const imgs = Array.from(body.querySelectorAll<HTMLImageElement>('img[data-md-src]'))
    // Chromium draws a broken-image icon beside the alt text; plain text reads better.
    const showAlt = (img: HTMLImageElement): void => {
      const span = document.createElement('span')
      span.className = 'md-img-missing'
      span.textContent = img.alt || img.dataset.mdSrc || 'image'
      span.title = img.dataset.mdSrc ?? ''
      img.replaceWith(span)
    }
    const loads = imgs.map(async (img) => {
      const src = img.dataset.mdSrc ?? ''
      const image = await window.api.doc.readImage(doc.id, src).catch(() => null)
      if (cancelled) return
      if (!image) {
        showAlt(img)
        return
      }
      const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mime }))
      urls.push(url)
      img.src = url
      await img.decode().catch(() => showAlt(img))
    })
    void Promise.allSettled(loads).then(() => {
      if (!cancelled && !touched.current) applyFraction()
    })
    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [html, doc.id, applyFraction])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const range = el.scrollHeight - el.clientHeight
    fraction.current = range > 0 ? Math.min(1, Math.max(0, el.scrollTop / range)) : 0
    onPositionChange(fraction.current)
  }, [onPositionChange])

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const a = (e.target as Element).closest('a')
      if (!a) return
      // Never let the renderer navigate: main blocks it anyway, silently.
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        let id = href.slice(1)
        try {
          id = decodeURIComponent(id)
        } catch {
          // keep it as written
        }
        touched.current = true
        bodyRef.current
          ?.querySelector(`[id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'start' })
      } else if (href) {
        onOpenExternal(href)
      }
    },
    [onOpenExternal]
  )

  // React's onWheel is passive, and Ctrl+wheel must not reach Chromium's page zoom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      touched.current = true
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      // Reflowing text is cheap, unlike re-rasterising PDF pages, so each event
      // commits straight away instead of waiting for the gesture to settle.
      onZoom(scale * wheelZoomFactor(e))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, onZoom])

  const markTouched = useCallback(() => {
    touched.current = true
  }, [])

  return (
    <div
      className="md-viewer"
      ref={scrollRef}
      tabIndex={-1}
      onScroll={onScroll}
      onPointerDown={markTouched}
      onKeyDown={markTouched}
      style={{ '--md-scale': scale } as React.CSSProperties}
    >
      {error ? (
        <div className="md-message">{error}</div>
      ) : html === null ? (
        <div className="md-message">Loading document…</div>
      ) : (
        <article
          className="md-page"
          ref={bodyRef}
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}
