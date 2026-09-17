import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_READING_PREFS } from '@shared/types'
import type { ReadingPrefs } from '@shared/types'
import { PAGE_BACKDROP, pageFilter, HIGHLIGHT_BLEND } from './colors'

export function useReadingPrefs(): [ReadingPrefs, (p: ReadingPrefs) => void] {
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS)

  useEffect(() => {
    void window.api.settings.getReading().then(setPrefs)
  }, [])

  // The filter lives on a CSS variable so it composes on the canvas only — never
  // on the page container, which would invert the highlight overlay too.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--page-filter', pageFilter(prefs.mode, prefs.dim, prefs.warmth))
    root.style.setProperty('--page-backdrop', PAGE_BACKDROP[prefs.mode])
    root.style.setProperty('--highlight-blend', HIGHLIGHT_BLEND[prefs.mode])
    root.dataset.uiTheme = prefs.uiTheme
  }, [prefs])

  const update = useCallback((next: ReadingPrefs) => {
    setPrefs(next)
    void window.api.settings.setReading(next)
  }, [])

  return [prefs, update]
}
