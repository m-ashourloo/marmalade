import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Highlight, HighlightColor, LabelRow, NewHighlightGroup } from '@shared/types'

/**
 * The page-parts of one selection, presented as a single highlight. Geometry
 * stays one row per page, but the sidebar and every action work on the group.
 */
export interface HighlightGroup {
  key: string
  /** Page-ascending. Always at least one. */
  members: Highlight[]
  /** The part on the lowest page — where the selection starts. */
  primary: Highlight
}

export interface HighlightsState {
  all: Highlight[]
  groups: HighlightGroup[]
  byPage: Map<number, Highlight[]>
  loading: boolean
  create: (input: NewHighlightGroup) => Promise<Highlight[]>
  setColor: (id: number, color: HighlightColor) => Promise<void>
  setNote: (id: number, body: string) => Promise<void>
  setLabels: (id: number, names: string[]) => Promise<void>
  /** The library-wide label vocabulary, for the picker and the filter bar. */
  vocabulary: LabelRow[]
  remove: (id: number) => Promise<number[]>
  /** Resync from the database after a bulk write the hook did not make itself. */
  reload: () => Promise<void>
}

/** A row with no group id is its own group of one. */
function groupKey(h: Highlight): string {
  return h.groupId ?? `id:${h.id}`
}

export function useHighlights(docId: number | null): HighlightsState {
  const [all, setAll] = useState<Highlight[]>([])
  const [vocabulary, setVocabulary] = useState<LabelRow[]>([])
  const [loading, setLoading] = useState(false)

  // Not keyed on docId: the vocabulary spans the library, and a label added here
  // has to survive into the next document opened.
  const refreshVocabulary = useCallback(async () => {
    setVocabulary(await window.api.annotations.listLabels())
  }, [])

  useEffect(() => {
    void refreshVocabulary()
  }, [refreshVocabulary])

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

  const create = useCallback(async (input: NewHighlightGroup): Promise<Highlight[]> => {
    const created = await window.api.annotations.createGroup(input)
    setAll((prev) => [...prev, ...created])
    return created
  }, [])

  const replace = useCallback((updated: Highlight[]) => {
    if (updated.length === 0) return
    const byId = new Map(updated.map((h) => [h.id, h]))
    setAll((prev) => prev.map((h) => byId.get(h.id) ?? h))
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

  const setLabels = useCallback(
    async (id: number, names: string[]) => {
      replace(await window.api.annotations.setLabels(id, names))
      // The write may have coined a label or pruned the last use of one.
      await refreshVocabulary()
    },
    [replace, refreshVocabulary]
  )

  const remove = useCallback(
    async (id: number): Promise<number[]> => {
      const removed = await window.api.annotations.deleteHl(id)
      const gone = new Set(removed)
      setAll((prev) => prev.filter((h) => !gone.has(h.id)))
      await refreshVocabulary()
      return removed
    },
    [refreshVocabulary]
  )

  const reload = useCallback(async () => {
    if (docId === null) return
    setAll(await window.api.annotations.listByDoc(docId))
    await refreshVocabulary()
  }, [docId, refreshVocabulary])

  const byPage = useMemo(() => {
    const map = new Map<number, Highlight[]>()
    for (const h of all) {
      const list = map.get(h.page)
      if (list) list.push(h)
      else map.set(h.page, [h])
    }
    return map
  }, [all])

  // Insertion order follows `all`, which the repo returns page-ascending, so the
  // sidebar keeps reading top-to-bottom through the document.
  const groups = useMemo(() => {
    const map = new Map<string, Highlight[]>()
    for (const h of all) {
      const key = groupKey(h)
      const list = map.get(key)
      if (list) list.push(h)
      else map.set(key, [h])
    }
    return Array.from(map.entries()).map(([key, members]) => {
      const sorted = [...members].sort((a, b) => a.page - b.page || a.id - b.id)
      return { key, members: sorted, primary: sorted[0] }
    })
  }, [all])

  return {
    all,
    groups,
    byPage,
    loading,
    vocabulary,
    create,
    setColor,
    setNote,
    setLabels,
    remove,
    reload
  }
}
