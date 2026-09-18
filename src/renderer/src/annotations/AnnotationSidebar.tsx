import { useEffect, useState } from 'react'
import type { Highlight, HighlightColor } from '@shared/types'
import type { HighlightGroup } from './useHighlights'
import { COLOR_LABEL, SWATCH } from '../theme/colors'

export interface AnnotationSidebarProps {
  /** One entry per selection — a cross-page drag is a single group, not one row per page. */
  groups: HighlightGroup[]
  activeId: number | null
  onSelect: (h: Highlight) => void
  onSetColor: (id: number, color: HighlightColor) => void
  onSetNote: (id: number, body: string) => void
  onDelete: (id: number) => void
}

export function AnnotationSidebar({
  groups,
  activeId,
  onSelect,
  onSetColor,
  onSetNote,
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
  onDelete
}: {
  highlight: Highlight
  lastPage: number
  active: boolean
  onSelect: () => void
  onSetColor: (c: HighlightColor) => void
  onSetNote: (body: string) => void
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
