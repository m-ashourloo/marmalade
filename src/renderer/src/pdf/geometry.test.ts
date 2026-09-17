import { beforeAll, describe, expect, it } from 'vitest'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { makeOnePagePdf } from './testPdf'
import {
  boundingBox,
  dedupeRects,
  normRectToViewport,
  viewportRectToNorm,
  type Rect
} from './geometry'

// A4 in PDF points.
const BOX = [0, 0, 595.28, 841.89]

// A real pdf.js page, so the tests exercise pdf.js's own viewport transform.
type PageViewport = ReturnType<Awaited<ReturnType<typeof loadPage>>['getViewport']>
let page: Awaited<ReturnType<typeof loadPage>>

async function loadPage() {
  const task = pdfjsLib.getDocument({
    data: makeOnePagePdf(BOX)
  })
  const doc = await task.promise
  return doc.getPage(1)
}

beforeAll(async () => {
  page = await loadPage()
})

function viewport(scale: number, rotation: number): PageViewport {
  return page.getViewport({ scale, rotation })
}

/** A rect in CSS pixels relative to the page container, at the given viewport. */
function sampleRect(vp: PageViewport, fx: number, fy: number, fw: number, fh: number): Rect {
  return {
    left: vp.width * fx,
    top: vp.height * fy,
    width: vp.width * fw,
    height: vp.height * fh
  }
}

describe('viewport <-> normalised round trip', () => {
  for (const scale of [1, 1.5, 2.5, 0.5]) {
    for (const rotation of [0, 90, 180, 270]) {
      it(`survives scale=${scale} rotation=${rotation}`, () => {
        const vp = viewport(scale, rotation)
        const original = sampleRect(vp, 0.12, 0.31, 0.4, 0.05)

        const norm = viewportRectToNorm(original, vp, BOX)
        const back = normRectToViewport(norm, vp, BOX)

        expect(back.left).toBeCloseTo(original.left, 1)
        expect(back.top).toBeCloseTo(original.top, 1)
        expect(back.width).toBeCloseTo(original.width, 1)
        expect(back.height).toBeCloseTo(original.height, 1)
      })
    }
  }

  it('is zoom independent: a rect captured at 1x renders correctly at 2.5x', () => {
    const at1 = viewport(1, 0)
    const at25 = viewport(2.5, 0)

    const captured = sampleRect(at1, 0.2, 0.4, 0.3, 0.02)
    const norm = viewportRectToNorm(captured, at1, BOX)
    const rendered = normRectToViewport(norm, at25, BOX)

    expect(rendered.left).toBeCloseTo(captured.left * 2.5, 1)
    expect(rendered.top).toBeCloseTo(captured.top * 2.5, 1)
    expect(rendered.width).toBeCloseTo(captured.width * 2.5, 1)
  })

  it('normalised coordinates stay within 0..1', () => {
    const vp = viewport(1.3, 0)
    const norm = viewportRectToNorm(sampleRect(vp, -0.2, -0.2, 2, 2), vp, BOX)
    for (const v of [norm.x0, norm.y0, norm.x1, norm.y1]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('a rect captured under rotation renders back under the same rotation', () => {
    const vp = viewport(1, 90)
    const original = sampleRect(vp, 0.3, 0.1, 0.2, 0.04)
    const back = normRectToViewport(viewportRectToNorm(original, vp, BOX), vp, BOX)
    expect(back.left).toBeCloseTo(original.left, 1)
    expect(back.top).toBeCloseTo(original.top, 1)
  })
})

describe('dedupeRects', () => {
  it('drops zero-area and contained rects', () => {
    const rects = [
      { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.2 },
      { x0: 0.2, y0: 0.12, x1: 0.3, y1: 0.18 }, // contained
      { x0: 0.1, y0: 0.3, x1: 0.1, y1: 0.4 }, // zero width
      { x0: 0.1, y0: 0.5, x1: 0.6, y1: 0.6 }
    ]
    expect(dedupeRects(rects)).toHaveLength(2)
  })
})

describe('boundingBox', () => {
  it('unions all rects', () => {
    expect(
      boundingBox([
        { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.55 },
        { x0: 0.1, y0: 0.45, x1: 0.6, y1: 0.5 }
      ])
    ).toEqual({ x0: 0.1, y0: 0.45, x1: 0.8, y1: 0.55 })
  })

  it('returns null for an empty list', () => {
    expect(boundingBox([])).toBeNull()
  })
})
