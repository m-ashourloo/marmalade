import { useEffect, useMemo, useRef, useState } from 'react'
import type { Highlight, HighlightColor, LabelRow } from '@shared/types'
import type { HighlightGroup } from './useHighlights'
import { COLOR_LABEL, SWATCH } from '../theme/colors'

export interface AnnotationSidebarProps {
  /** One entry per selection — a cross-page drag is a single group, not one row per page. */
  groups: HighlightGroup[]
  activeId: number | null
  onSelect: (h: Highlight) => void
  onSetColor: (id: number, color: HighlightColor) => void
  onSetNote: (id: number, body: string) => void
  /** Replaces the whole set; the row computes the next names itself. */
  onSetLabels: (id: number, names: string[]) => void
  /** Library-wide label names, offered as suggestions in the picker. */
  vocabulary: LabelRow[]
  onDelete: (id: number) => void
}

export function AnnotationSidebar({
  groups,
  activeId,
  onSelect,
  onSetColor,
  onSetNote,
  onSetLabels,
  vocabulary,
  onDelete
}: AnnotationSidebarProps): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <div className="sidebar-empty">
        Select text in the page to highlight it. Every highlight can carry a note.
      </div>
    )
  }

  return (
    <>
      {groups.map((g) => (
        <AnnotationItem
          key={g.key}
          highlight={g.primary}
          lastPage={g.members[g.members.length - 1].page}
          active={g.members.some((m) => m.id === activeId)}
          onSelect={() => onSelect(g.primary)}
          onSetColor={(c) => onSetColor(g.primary.id, c)}
          onSetNote={(b) => onSetNote(g.primary.id, b)}
          onSetLabels={(names) => onSetLabels(g.primary.id, names)}
          vocabulary={vocabulary}
          onDelete={() => onDelete(g.primary.id)}
        />
      ))}
    </>
  )
}

function AnnotationItem({
  highlight,
  lastPage,
  active,
  onSelect,
  onSetColor,
  onSetNote,
  onSetLabels,
  vocabulary,
  onDelete
}: {
  highlight: Highlight
  lastPage: number
  active: boolean
  onSelect: () => void
  onSetColor: (c: HighlightColor) => void
  onSetNote: (body: string) => void
  onSetLabels: (names: string[]) => void
  vocabulary: LabelRow[]
  onDelete: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(highlight.note ?? '')

  // Keep the draft in step when the highlight is updated elsewhere.
  useEffect(() => {
    if (!editing) setDraft(highlight.note ?? '')
  }, [highlight.note, editing])

  return (
    <div
      className={`ann-item${active ? ' active' : ''}`}
      data-ann={highlight.id}
      onClick={onSelect}
      style={{ ['--q' as string]: SWATCH[highlight.color] }}
    >
      <div className="quote">{highlight.quotedText}</div>

      {!editing && highlight.note && <div className="note-body">{highlight.note}</div>}

      {editing && (
        <textarea
          autoFocus
          value={draft}
          placeholder="Write a note…"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(highlight.note ?? '')
              setEditing(false)
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              onSetNote(draft)
              setEditing(false)
            }
          }}
        />
      )}

      <LabelStrip labels={highlight.labels} vocabulary={vocabulary} onChange={onSetLabels} />

      <div className="meta">
        <span>
          {lastPage > highlight.page ? `Pages ${highlight.page}–${lastPage}` : `Page ${highlight.page}`}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {(Object.keys(SWATCH) as HighlightColor[]).map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ width: 13, height: 13, background: SWATCH[c] }}
            aria-pressed={c === highlight.color}
            title={COLOR_LABEL[c]}
            onClick={(e) => {
              e.stopPropagation()
              onSetColor(c)
            }}
          />
        ))}
      </div>

      <div className={`ann-actions${editing ? ' editing' : ''}`} onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <button
              className="primary"
              onClick={() => {
                onSetNote(draft)
                setEditing(false)
              }}
            >
              Save
            </button>
            <button
              onClick={() => {
                setDraft(highlight.note ?? '')
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}>
              {highlight.note ? 'Edit note' : 'Add note'}
            </button>
            <button className="destructive" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The chips on one annotation, plus the picker that adds to them. Every handler
 * stops propagation: the row behind it navigates the viewer on click.
 */
function LabelStrip({
  labels,
  vocabulary,
  onChange
}: {
  labels: string[]
  vocabulary: LabelRow[]
  onChange: (names: string[]) => void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (picking) inputRef.current?.focus()
  }, [picking])

  const suggestions = useMemo(() => {
    const already = new Set(labels.map((l) => l.toLowerCase()))
    const q = query.trim().toLowerCase()
    return vocabulary
      .filter((v) => !already.has(v.name.toLowerCase()) && v.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [vocabulary, labels, query])

  // An exact match is added rather than duplicated, which is also what the repo
  // would do — doing it here keeps the chip list from flickering.
  function add(name: string): void {
    const trimmed = name.replace(/\s+/g, ' ').trim()
    if (trimmed === '') return
    if (!labels.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...labels, trimmed])
    }
    setQuery('')
    setPicking(false)
  }

  function close(): void {
    setQuery('')
    setPicking(false)
  }

  return (
    <div className="label-strip" onClick={(e) => e.stopPropagation()}>
      {labels.map((name) => (
        <span key={name} className="label-chip">
          {name}
          <button
            className="label-x"
            aria-label={`Remove label ${name}`}
            title={`Remove label ${name}`}
            onClick={() => onChange(labels.filter((l) => l !== name))}
          >
            ×
          </button>
        </span>
      ))}

      {picking ? (
        <span className="label-picker">
          <input
            ref={inputRef}
            className="label-input"
            value={query}
            placeholder="Label…"
            maxLength={64}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => {
              // Delayed so a click landing on a suggestion still registers.
              window.setTimeout(close, 120)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'Enter') add(query)
            }}
          />
          {suggestions.length > 0 && (
            <div className="label-suggestions">
              {suggestions.map((s) => (
                <button key={s.name} onMouseDown={() => add(s.name)}>
                  {s.name}
                  <span className="label-count">{s.useCount}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button className="label-add" onClick={() => setPicking(true)}>
          + Label
        </button>
      )}
    </div>
  )
}
