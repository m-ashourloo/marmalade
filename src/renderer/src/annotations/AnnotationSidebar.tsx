import { useEffect, useState } from 'react'
import type { Highlight, HighlightColor } from '@shared/types'
import { COLOR_LABEL, SWATCH } from '../theme/colors'

export interface AnnotationSidebarProps {
  highlights: Highlight[]
  activeId: number | null
  onSelect: (h: Highlight) => void
  onSetColor: (id: number, color: HighlightColor) => void
  onSetNote: (id: number, body: string) => void
  onDelete: (id: number) => void
}

export function AnnotationSidebar({
  highlights,
  activeId,
  onSelect,
  onSetColor,
  onSetNote,
  onDelete
}: AnnotationSidebarProps): React.JSX.Element {
  if (highlights.length === 0) {
    return (
      <div className="sidebar-empty">
        No highlights yet.
        <br />
        Select text in the document to highlight it and attach a note.
      </div>
    )
  }

  return (
    <>
      {highlights.map((h) => (
        <AnnotationItem
          key={h.id}
          highlight={h}
          active={h.id === activeId}
          onSelect={() => onSelect(h)}
          onSetColor={(c) => onSetColor(h.id, c)}
          onSetNote={(b) => onSetNote(h.id, b)}
          onDelete={() => onDelete(h.id)}
        />
      ))}
    </>
  )
}

function AnnotationItem({
  highlight,
  active,
  onSelect,
  onSetColor,
  onSetNote,
  onDelete
}: {
  highlight: Highlight
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
        <span>Page {highlight.page}</span>
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

      <div className="ann-actions" onClick={(e) => e.stopPropagation()}>
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
            <button style={{ color: 'var(--danger)' }} onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
