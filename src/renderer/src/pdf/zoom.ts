export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
export const ZOOM_MIN = ZOOM_STEPS[0]
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]

export function clampZoom(scale: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale))
}

/**
 * The next preset strictly beyond `current`. Wheel and pinch zoom leave the scale
 * between presets, and rounding to the nearest one first would skip a step.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const eps = 1e-3
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + eps) ?? ZOOM_MAX
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < current - eps) return ZOOM_STEPS[i]
  }
  return ZOOM_MIN
}

const LINE_PX = 40
const PAGE_PX = 800
/** One mouse-wheel notch arrives as ~100px; capping it here makes a notch a
 *  ~1.22x step, close to the preset spacing, instead of a 2.7x lurch. */
const MAX_DELTA_PX = 20

/**
 * Multiplicative zoom for one Ctrl+wheel event.
 *
 * Chromium turns a touchpad pinch into a Ctrl+wheel with deltaY = -100·ln(scale),
 * so exp(-deltaY / 100) reproduces the pinch exactly. Pinch deltas are small
 * enough that the cap never touches them; it only tames mouse notches.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number }): number {
  const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? e.deltaY * PAGE_PX : e.deltaY
  const capped = Math.max(-MAX_DELTA_PX, Math.min(MAX_DELTA_PX, px))
  return Math.exp(-capped / 100)
}
