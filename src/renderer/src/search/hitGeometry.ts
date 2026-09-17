import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { NormRect } from '@shared/types'
import type { PageIndex, RawMatch } from './normalize'
import { rawOffsetToItem } from './normalize'

/**
 * Turn a match into normalised page rectangles, derived from each text item's own
 * transform rather than from DOM ranges.
 *
 * This deliberately avoids the DOM: search must produce rectangles for pages that
 * are not currently mounted (that is the whole point of virtualisation), and a
 * geometric derivation works identically for mounted and unmounted pages.
 *
 * `item.transform` is [a, b, c, d, e, f] where (e, f) is the item's origin on the
 * baseline in PDF user space, `width` is its advance width and `height` its glyph
 * height — both already in user-space units.
 */
export function matchToNormRects(
  index: PageIndex,
  match: RawMatch,
  items: TextItem[],
  pageBox: number[]
): NormRect[] {
  const start = rawOffsetToItem(index, match.rawStart)
  const end = rawOffsetToItem(index, Math.max(match.rawStart, match.rawEnd - 1))

  const bx = pageBox[0]
  const by = pageBox[1]
  const bw = pageBox[2] - pageBox[0]
  const bh = pageBox[3] - pageBox[1]
  const rects: NormRect[] = []

  for (let i = start.itemIndex; i <= end.itemIndex && i < items.length; i++) {
    const item = items[i]
    const len = item.str.length
    if (len === 0 || item.width === 0) continue

    // Fraction of this item covered by the match.
    const from = i === start.itemIndex ? start.charOffset : 0
    const to = i === end.itemIndex ? end.charOffset + 1 : len
    const f0 = Math.max(0, Math.min(1, from / len))
    const f1 = Math.max(0, Math.min(1, to / len))
    if (f1 <= f0) continue

    const originX = item.transform[4]
    const originY = item.transform[5]
    const vertical = Math.abs(item.transform[1]) > Math.abs(item.transform[0])

    let x0: number, y0: number, x1: number, y1: number
    if (vertical) {
      x0 = originX
      x1 = originX + item.height
      y0 = originY - item.width * f1
      y1 = originY - item.width * f0
    } else {
      x0 = originX + item.width * f0
      x1 = originX + item.width * f1
      // transform[5] sits on the baseline; extend a little below for descenders.
      y0 = originY - item.height * 0.2
      y1 = originY + item.height * 0.9
    }

    rects.push({
      x0: clamp01((Math.min(x0, x1) - bx) / bw),
      y0: clamp01((Math.min(y0, y1) - by) / bh),
      x1: clamp01((Math.max(x0, x1) - bx) / bw),
      y1: clamp01((Math.max(y0, y1) - by) / bh)
    })
  }

  return rects
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
