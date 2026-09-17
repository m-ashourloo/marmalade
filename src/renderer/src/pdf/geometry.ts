import type { NormRect } from '@shared/types'

/**
 * The slice of pdf.js's PageViewport this module needs. Declared structurally so
 * the conversions can be unit-tested against a real viewport or a stub.
 */
export interface ViewportLike {
  width: number
  height: number
  scale: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

/** `page.view` — the crop box as [x0, y0, x1, y1] in PDF user space. */
export type PageBox = number[]

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Viewport-space rectangle (CSS pixels, relative to the page container's top-left)
 * to a rectangle normalised 0..1 against the crop box.
 *
 * Goes through convertToPdfPoint rather than dividing by scale, because the
 * viewport also encodes page rotation.
 */
export function viewportRectToNorm(r: Rect, viewport: ViewportLike, box: PageBox): NormRect {
  const [ax, ay] = viewport.convertToPdfPoint(r.left, r.top)
  const [bx, by] = viewport.convertToPdfPoint(r.left + r.width, r.top + r.height)

  const bw = box[2] - box[0]
  const bh = box[3] - box[1]
  const nx0 = (Math.min(ax, bx) - box[0]) / bw
  const nx1 = (Math.max(ax, bx) - box[0]) / bw
  const ny0 = (Math.min(ay, by) - box[1]) / bh
  const ny1 = (Math.max(ay, by) - box[1]) / bh

  return {
    x0: clamp01(nx0),
    y0: clamp01(ny0),
    x1: clamp01(nx1),
    y1: clamp01(ny1)
  }
}

/**
 * The inverse: a stored normalised rect back to CSS pixels for the current
 * viewport. Called on every zoom change — highlights are always re-laid out from
 * the stored geometry, never CSS-transform-scaled (which would blur their edges
 * against crisply re-rendered text).
 */
export function normRectToViewport(n: NormRect, viewport: ViewportLike, box: PageBox): Rect {
  const bw = box[2] - box[0]
  const bh = box[3] - box[1]
  // pdf.js 6 removed convertToViewportRectangle; convert the two corners instead.
  // Both corners must go through the transform because it may rotate the page.
  const [vx0, vy0] = viewport.convertToViewportPoint(box[0] + n.x0 * bw, box[1] + n.y0 * bh)
  const [vx1, vy1] = viewport.convertToViewportPoint(box[0] + n.x1 * bw, box[1] + n.y1 * bh)
  return {
    left: Math.min(vx0, vx1),
    top: Math.min(vy0, vy1),
    width: Math.abs(vx1 - vx0),
    height: Math.abs(vy1 - vy0)
  }
}

/** DOMRect (viewport/client coordinates) to page-container-relative coordinates. */
export function clientRectToPageRect(client: DOMRect, pageRect: DOMRect): Rect {
  return {
    left: client.left - pageRect.left,
    top: client.top - pageRect.top,
    width: client.width,
    height: client.height
  }
}

/**
 * Drop rects that are empty or fully contained in another. Browsers emit one rect
 * per line fragment, but nested inline elements can produce duplicates.
 */
export function dedupeRects(rects: NormRect[]): NormRect[] {
  const kept: NormRect[] = []
  for (const r of rects) {
    if (r.x1 - r.x0 < 1e-6 || r.y1 - r.y0 < 1e-6) continue
    const contained = kept.some(
      (k) => r.x0 >= k.x0 - 1e-6 && r.x1 <= k.x1 + 1e-6 && r.y0 >= k.y0 - 1e-6 && r.y1 <= k.y1 + 1e-6
    )
    if (!contained) kept.push(r)
  }
  return kept
}

/** Union bounding box, used to scroll a highlight into view. */
export function boundingBox(rects: NormRect[]): NormRect | null {
  if (rects.length === 0) return null
  return rects.reduce((acc, r) => ({
    x0: Math.min(acc.x0, r.x0),
    y0: Math.min(acc.y0, r.y0),
    x1: Math.max(acc.x1, r.x1),
    y1: Math.max(acc.y1, r.y1)
  }))
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
