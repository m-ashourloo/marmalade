import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Highlight, HighlightColor, NewHighlight } from '@shared/types'

export interface HighlightsState {
  all: Highlight[]
  byPage: Map<number, Highlight[]>
  loading: boolean
  create: (input: NewHighlight) => Promise<Highlight | null>
  setColor: (id: number, color: HighlightColor) => Promise<void>
  setNote: (id: number, body: string) => Promise<void>
  remove: (id: number) => Promise<void>
  /** Resync from the database after a bulk write the hook did not make itself. */
  reload: () => Promise<void>
}

export function useHighlights(docId: number | null): HighlightsState {
  const [all, setAll] = useState<Highlight[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (docId === null) {
      setAll([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api.annotations
      .listByDoc(docId)
      .then((list) => {
        if (!cancelled) setAll(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  const create = useCallback(async (input: NewHighlight): Promise<Highlight | null> => {
    const created = await window.api.annotations.createHl(input)
    setAll((prev) => [...prev, created])
    return created
  }, [])

  const replace = useCallback((updated: Highlight | null) => {
    if (!updated) return
    setAll((prev) => prev.map((h) => (h.id === updated.id ? updated : h)))
  }, [])

  const setColor = useCallback(
    async (id: number, color: HighlightColor) => {
      replace(await window.api.annotations.updateHl(id, { color }))
    },
    [replace]
  )

  const setNote = useCallback(
    async (id: number, body: string) => {
      replace(await window.api.annotations.upsertNote(id, body))
    },
    [replace]
  )

  const remove = useCallback(async (id: number) => {
    await window.api.annotations.deleteHl(id)
    setAll((prev) => prev.filter((h) => h.id !== id))
  }, [])

  const reload = useCallback(async () => {
    if (docId === null) return
    setAll(await window.api.annotations.listByDoc(docId))
  }, [docId])

  const byPage = useMemo(() => {
    const map = new Map<number, Highlight[]>()
    for (const h of all) {
      const list = map.get(h.page)
      if (list) list.push(h)
      else map.set(h.page, [h])
    }
    return map
  }, [all])

  return { all, byPage, loading, create, setColor, setNote, remove, reload }
}
