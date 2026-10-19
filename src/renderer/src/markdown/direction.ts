export type TextDirection = 'rtl' | 'ltr'

// Scripts written right to left. JS regexes have no Bidi_Class property, so the
// scripts are listed; together they cover every strong-RTL letter in Unicode.
const RTL_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}]/u
const LETTER = /\p{L}/gu

/**
 * The direction a block of text reads in, or null when it has no letters at all
 * (numbers, punctuation, an image) and should simply inherit.
 *
 * Decided by which kind of letter is in the majority rather than by the first
 * one, as `dir="auto"` does: technical Persian or Hebrew routinely opens a
 * sentence with an English name ("React یک کتابخانه است"), and first-strong
 * would lay that whole paragraph out left to right.
 */
export function textDirection(text: string): TextDirection | null {
  let rtl = 0
  let ltr = 0
  let first: TextDirection | null = null
  for (const [ch] of text.matchAll(LETTER)) {
    const isRtl = RTL_LETTER.test(ch)
    if (isRtl) rtl++
    else ltr++
    first ??= isRtl ? 'rtl' : 'ltr'
  }
  if (rtl === ltr) return first
  return rtl > ltr ? 'rtl' : 'ltr'
}

/** Blocks that get their own direction. Lists and tables take one too, since
 *  that decides which side the bullets and the first column sit on. */
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, ul, ol, table, th, td, dt, dd'

/** Where a list item's own text ends and its nested blocks begin. */
const ITEM_BLOCK = new Set(['UL', 'OL', 'P', 'PRE', 'BLOCKQUOTE', 'TABLE', 'DIV', 'HR'])

/** Code is identifiers and syntax, not prose; counting it would tip a Persian
 *  paragraph that quotes `npm install` towards LTR. */
function proseText(el: Element): string {
  if (!el.querySelector('code')) return el.textContent ?? ''
  const copy = el.cloneNode(true) as Element
  for (const code of copy.querySelectorAll('code')) code.remove()
  return copy.textContent ?? ''
}

/** Sets `dir` on every block of rendered Markdown, and on the root itself. */
export function applyDirections(root: HTMLElement): void {
  root.dir = textDirection(proseText(root)) ?? 'ltr'
  for (const el of root.querySelectorAll<HTMLElement>(BLOCKS)) {
    const dir = textDirection(proseText(el))
    if (!dir) continue
    const listDir = el.tagName === 'LI' ? el.parentElement?.dir : undefined
    if (listDir && listDir !== dir) isolateItemText(el, dir)
    else el.dir = dir
  }
}

/**
 * A Persian item in an English list (or the reverse) keeps the list's side for
 * its bullet and alignment — flipping the item alone hangs its bullet off the
 * far edge of the page — and only its text is reordered, in an isolated span.
 */
function isolateItemText(li: HTMLElement, dir: TextDirection): void {
  const span = document.createElement('span')
  span.dir = dir
  let node = li.firstChild
  // A task item's checkbox belongs to the list, not to the text.
  if (node instanceof HTMLInputElement) node = node.nextSibling
  while (node && !(node instanceof HTMLElement && ITEM_BLOCK.has(node.tagName))) {
    const next = node.nextSibling
    span.appendChild(node)
    node = next
  }
  if (span.hasChildNodes()) li.insertBefore(span, node)
}
