import { useEffect, useRef } from 'react'
import type { ReadingMode, ReadingPrefs } from '@shared/types'

const MODES: { key: ReadingMode; label: string; hint: string }[] = [
  { key: 'normal', label: 'Normal', hint: 'Original page colours' },
  { key: 'sepia', label: 'Sepia', hint: 'Warm paper tone, easier in low light' },
  { key: 'dark', label: 'Dark', hint: 'Inverted pages for night reading' }
]

export function ReadingModePopover({
  prefs,
  onChange,
  onClose
}: {
  prefs: ReadingPrefs
  onChange: (p: ReadingPrefs) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="popover" ref={ref}>
      <h3>Reading mode</h3>
      <div className="mode-row">
        {MODES.map((m) => (
          <button
            key={m.key}
            aria-pressed={prefs.mode === m.key}
            title={m.hint}
            onClick={() => onChange({ ...prefs, mode: m.key })}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="slider-row">
        <label>
          <span>Brightness</span>
          <span>{Math.round(prefs.dim * 100)}%</span>
        </label>
        <input
          type="range"
          min={0.55}
          max={1}
          step={0.01}
          value={prefs.dim}
          onChange={(e) => onChange({ ...prefs, dim: Number(e.target.value) })}
        />
      </div>

      <div className="slider-row">
        <label>
          <span>Warmth</span>
          <span>{Math.round(prefs.warmth * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={prefs.warmth}
          onChange={(e) => onChange({ ...prefs, warmth: Number(e.target.value) })}
        />
      </div>

      <h3 style={{ marginTop: 16 }}>Interface</h3>
      <div className="mode-row" style={{ marginBottom: 4 }}>
        <button
          aria-pressed={prefs.uiTheme === 'dark'}
          onClick={() => onChange({ ...prefs, uiTheme: 'dark' })}
        >
          Dark
        </button>
        <button
          aria-pressed={prefs.uiTheme === 'light'}
          onClick={() => onChange({ ...prefs, uiTheme: 'light' })}
        >
          Light
        </button>
      </div>
    </div>
  )
}
