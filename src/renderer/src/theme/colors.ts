import type { HighlightColor, ReadingMode } from '@shared/types'

/**
 * Highlights are stored as semantic keys, not hex, precisely so they can be
 * resolved per reading mode.
 *
 * On a normal page the layer blends with `multiply`, which darkens — correct over
 * white paper. Over an inverted (black) page multiply yields black, so dark mode
 * switches to `screen` and uses dim fills that lighten instead.
 */
export const HIGHLIGHT_FILL: Record<ReadingMode, Record<HighlightColor, string>> = {
  normal: {
    yellow: 'rgba(255, 224, 102, 0.85)',
    green: 'rgba(150, 230, 160, 0.80)',
    blue: 'rgba(150, 200, 255, 0.80)',
    pink: 'rgba(255, 170, 200, 0.80)',
    orange: 'rgba(255, 190, 120, 0.85)'
  },
  sepia: {
    yellow: 'rgba(250, 210, 90, 0.80)',
    green: 'rgba(160, 215, 155, 0.75)',
    blue: 'rgba(160, 195, 235, 0.75)',
    pink: 'rgba(240, 175, 190, 0.75)',
    orange: 'rgba(245, 180, 110, 0.80)'
  },
  dark: {
    yellow: 'rgba(120, 100, 20, 0.85)',
    green: 'rgba(40, 105, 55, 0.85)',
    blue: 'rgba(40, 80, 130, 0.85)',
    pink: 'rgba(120, 50, 80, 0.85)',
    orange: 'rgba(125, 70, 20, 0.85)'
  }
}

export const HIGHLIGHT_BLEND: Record<ReadingMode, string> = {
  normal: 'multiply',
  sepia: 'multiply',
  dark: 'screen'
}

/** Swatch colour for the picker UI — always the bright form, regardless of mode. */
export const SWATCH: Record<HighlightColor, string> = HIGHLIGHT_FILL.normal

export const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  orange: 'Orange'
}

/** The CSS filter applied to the page canvas, and nothing else. */
export function pageFilter(mode: ReadingMode, dim: number, warmth: number): string {
  const base =
    mode === 'dark'
      ? // invert flips luminance and hue; hue-rotate puts the hue back, so a red
        // logo stays reddish instead of turning cyan.
        'invert(1) hue-rotate(180deg)'
      : mode === 'sepia'
        ? 'sepia(0.45) saturate(0.85) brightness(0.92)'
        : ''
  const parts = [base, `brightness(${dim})`]
  if (warmth > 0) parts.push(`sepia(${warmth})`)
  return parts.filter(Boolean).join(' ')
}

/** Page gutter background, chosen to sit comfortably behind the filtered page. */
export const PAGE_BACKDROP: Record<ReadingMode, string> = {
  normal: '#3a3d42',
  sepia: '#4a4337',
  dark: '#141518'
}
