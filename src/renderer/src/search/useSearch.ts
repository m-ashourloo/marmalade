import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { buildIndexFromRaw, findMatches, flattenItems, normalize, snippet } from './normalize'
import type { PageIndex } from './normalize'
import { matchToNormRects } from './hitGeometry'
import { DEFAULT_SEARCH_OPTIONS } from './types'
import type { SearchHit, SearchOptions } from './types'

interface CachedPage {
  raw: string
  itemStarts: number[]
  items: TextItem[] | null
}

export interface SearchState {
  query: string
  setQuery: (q: string) => void
  options: SearchOptions
  setOptions: (o: SearchOptions) => void
  hits: SearchHit[]
  hitsByPage: Map<number, SearchHit[]>
  currentIndex: number
  current: SearchHit | null
  next: () => void
  prev: () => void
  goTo: (index: number) => void
  indexing: boolean
  clear: () => void
}

const DEBOUNCE_MS = 150
/** Yield to the event loop every N pages so typing stays responsive. */
const YIELD_EVERY = 12

export function useSearch(
  docId: number | null,
  pdf: PDFDocumentProxy | null,
  pageBoxes: number[][]
): SearchState {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [indexing, setIndexing] = useState(false)

  const cache = useRef<Map<number, CachedPage>>(new Map())
  const runId = useRef(0)

  // Reset the text cache whenever the document changes.
  useEffect(() => {
    cache.current = new Map()
    setHits([])
    setCurrentIndex(0)
    setQuery('')
  }, [docId])

  /** Pull a page's text, preferring the cache, then the DB, then pdf.js. */
  const loadPage = useCallback(
    async (pageNumber: number, needItems: boolean): Promise<CachedPage | null> => {
      if (!pdf) return null
      const existing = cache.current.get(pageNumber)
      if (existing && (!needItems || existing.items)) return existing

      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter((i): i is TextItem => 'str' in i)
      const { raw, itemStarts } = flattenItems(items)
      const entry: CachedPage = { raw, itemStarts, items }
      cache.current.set(pageNumber, entry)
      return entry
    },
    [pdf]
  )

  // Warm the cache from the database so reopening a long book searches instantly.
  useEffect(() => {
    if (docId === null || !pdf) return
    let cancelled = false
    void (async () => {
      const rows = await window.api.doc.getPageText(docId).catch(() => [])
      if (cancelled) return
      for (const row of rows) {
        if (!cache.current.has(row.page)) {
          cache.current.set(row.page, { raw: row.text, itemStarts: row.offsets, items: null })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId, pdf])

  // ---- the search pass ----------------------------------------------------
  useEffect(() => {
    if (!pdf || query.trim() === '') {
      setHits([])
      setCurrentIndex(0)
      setIndexing(false)
      return
    }

    const myRun = ++runId.current
    const timer = setTimeout(() => {
      void (async () => {
        setIndexing(true)
        const needle = normalize(query, options).text
        if (needle === '') {
          setHits([])
          setIndexing(false)
          return
        }

        const collected: SearchHit[] = []
        const freshText: { page: number; text: string; offsets: number[] }[] = []

        for (let p = 1; p <= pdf.numPages; p++) {
          if (runId.current !== myRun) return

          const cached = cache.current.get(p)
          let entry: CachedPage | null = cached ?? null
          if (!entry) {
            entry = await loadPage(p, false)
            if (entry) freshText.push({ page: p, text: entry.raw, offsets: entry.itemStarts })
          }
          if (!entry) continue

          const index: PageIndex = buildIndexFromRaw(p, entry.raw, entry.itemStarts, options)
          const matches = findMatches(index, needle, options.wholeWord)
          if (matches.length === 0) {
            if (p % YIELD_EVERY === 0) await yieldToLoop()
            continue
          }

          // Only pages that actually contain a match need their item geometry.
          const withItems = entry.items ? entry : await loadPage(p, true)
          if (!withItems?.items) continue
          const box = pageBoxes[p - 1] ?? [0, 0, 612, 792]

          for (const m of matches) {
            const s = snippet(index, m)
            collected.push({
              id: `${p}:${m.normStart}`,
              page: p,
              rects: matchToNormRects(index, m, withItems.items, box),
              before: s.before,
              hit: s.hit,
              after: s.after
            })
          }

          if (runId.current !== myRun) return
          // Publish progressively so results appear while long documents index.
          setHits([...collected])
          await yieldToLoop()
        }

        if (runId.current !== myRun) return
        setHits(collected)
        setCurrentIndex(0)
        setIndexing(false)

        if (docId !== null && freshText.length > 0) {
          void window.api.doc.putPageText(docId, freshText).catch(() => undefined)
        }
      })()
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, options, pdf, docId, loadPage, pageBoxes])

  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>()
    for (const h of hits) {
      const list = map.get(h.page)
      if (list) list.push(h)
      else map.set(h.page, [h])
    }
    return map
  }, [hits])

  const next = useCallback(() => {
    setCurrentIndex((i) => (hits.length === 0 ? 0 : (i + 1) % hits.length))
  }, [hits.length])

  const prev = useCallback(() => {
    setCurrentIndex((i) => (hits.length === 0 ? 0 : (i - 1 + hits.length) % hits.length))
  }, [hits.length])

  const clear = useCallback(() => {
    setQuery('')
    setHits([])
    setCurrentIndex(0)
  }, [])

  return {
    query,
    setQuery,
    options,
    setOptions,
    hits,
    hitsByPage,
    currentIndex,
    current: hits[currentIndex] ?? null,
    next,
    prev,
    goTo: setCurrentIndex,
    indexing,
    clear
  }
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
