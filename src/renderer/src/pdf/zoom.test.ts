import { describe, expect, it } from 'vitest'
import { clampZoom, stepZoom, wheelZoomFactor, ZOOM_MAX, ZOOM_MIN } from './zoom'

describe('stepZoom', () => {
  it('moves one preset from a preset', () => {
    expect(stepZoom(1.25, 1)).toBe(1.5)
    expect(stepZoom(1.25, -1)).toBe(1)
  })

  it('takes the adjacent preset from between presets, skipping none', () => {
    expect(stepZoom(1.3, 1)).toBe(1.5)
    expect(stepZoom(1.3, -1)).toBe(1.25)
  })

  it('stops at the ends', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
})

describe('wheelZoomFactor', () => {
  const PIXEL = 0
  const LINE = 1

  it('reproduces a pinch exactly', () => {
    // Chromium: deltaY = -100 * ln(scale)
    const scale = 1.05
    expect(wheelZoomFactor({ deltaY: -100 * Math.log(scale), deltaMode: PIXEL })).toBeCloseTo(scale)
  })

  it('zooms in on wheel up and out on wheel down', () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: PIXEL })).toBeGreaterThan(1)
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: PIXEL })).toBeLessThan(1)
  })

  it('caps a mouse notch to a preset-sized step', () => {
    const f = wheelZoomFactor({ deltaY: -100, deltaMode: PIXEL })
    expect(f).toBeGreaterThan(1.15)
    expect(f).toBeLessThan(1.3)
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: LINE })).toBeCloseTo(f)
  })

  it('round-trips in and out', () => {
    const up = wheelZoomFactor({ deltaY: -100, deltaMode: PIXEL })
    const down = wheelZoomFactor({ deltaY: 100, deltaMode: PIXEL })
    expect(up * down).toBeCloseTo(1)
  })
})

describe('clampZoom', () => {
  it('keeps the scale within the presets', () => {
    expect(clampZoom(100)).toBe(ZOOM_MAX)
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(1.33)).toBe(1.33)
  })
})
