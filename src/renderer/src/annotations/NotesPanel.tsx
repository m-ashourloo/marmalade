import { useMemo, useState } from 'react'
import type { Highlight, HighlightColor, LabelRow } from '@shared/types'
import type { HighlightGroup } from './useHighlights'
import { AnnotationSidebar } from './AnnotationSidebar'

/** Sentinel for the pill matching annotations that carry no label at all. A
 *  leading space keeps it from colliding with a real label, which is trimmed. */
const UNLABELLED = ' unlabelled'

export interface NotesPanelProps {
  groups: HighlightGroup[]
  vocabulary: LabelRow[]
  activeId: number | null
  onSelect: (h: Highlight) => void
  onSetColor: (id: number, color: HighlightColor) => void
  onSetNote: (id: number, body: string) => void
  onSetLabels: (id: number, names: string[]) => void
  onDelete: (id: number) => void
}

/**
 * The Notes tab: a pinned label filter above the scrolling list. It owns its own
 * `.sidebar-body` — like SearchPanel, and unlike the outline — so the filter bar
 * stays put while the notes scroll under it.
 */
export function NotesPanel({
  groups,
  vocabulary,
  activeId,
  onSelect,
  onSetColor,
  onSetNote,
  onSetLabels,
  onDelete
}: NotesPanelProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // The bar offers only what this document actually uses — the vocabulary is
  // library-wide and would otherwise fill up with other PDFs' labels. Order
  // follows the vocabulary, which the repo returns sorted by name.
  const present = useMemo(() => {
    const used = new Set<string>()
    for (const g of groups) for (const name of g.primary.labels) used.add(name)
    return vocabulary.filter((v) => used.has(v.name))
  }, [groups, vocabulary])

  const anyUnlabelled = useMemo(() => groups.some((g) => g.primary.labels.length === 0), [groups])

  // A selected label can vanish from the document while the filter is up — the
  // user just removed the last chip carrying it — which would otherwise leave
  // the list empty with no visible pill to explain why.
  const active = useMemo(() => {
    const offered = new Set<string>(present.map((p) => p.name))
    if (anyUnlabelled) offered.add(UNLABELLED)
    return new Set([...selected].filter((s) => offered.has(s)))
  }, [selected, present, anyUnlabelled])

  const shown = useMemo(() => {
    if (active.size === 0) return groups
    return groups.filter((g) =>
      g.primary.labels.length === 0
        ? active.has(UNLABELLED)
        : g.primary.labels.some((l) => active.has(l))
    )
  }, [groups, active])

  function toggle(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const hasBar = present.length > 0 || anyUnlabelled

  return (
    <>
      {hasBar && (
        <div className="notes-filter">
          {present.map((l) => (
            <button
              key={l.name}
              className="label-chip filter"
              aria-pressed={active.has(l.name)}
              onClick={() => toggle(l.name)}
            >
              {l.name}
            </button>
          ))}
          {anyUnlabelled && (
            <button
              className="label-chip filter"
              aria-pressed={active.has(UNLABELLED)}
              onClick={() => toggle(UNLABELLED)}
            >
              Unlabelled
            </button>
          )}
          {active.size > 0 && (
            <>
              <span className="notes-count">
                {shown.length} of {groups.length}
              </span>
              <button className="filter-clear" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <div className="sidebar-body">
        {active.size > 0 && shown.length === 0 ? (
          <div className="sidebar-empty">No notes carry these labels.</div>
        ) : (
          <AnnotationSidebar
            groups={shown}
            vocabulary={vocabulary}
            activeId={activeId}
            onSelect={onSelect}
            onSetColor={onSetColor}
            onSetNote={onSetNote}
            onSetLabels={onSetLabels}
            onDelete={onDelete}
          />
        )}
      </div>
    </>
  )
}
