import { useEffect, useRef, useState } from 'react'
import type { CategoryRow } from '@shared/types'
import { Icon } from '../ui/Icon'

/**
 * Which shelf the library screen is showing. A number is a category id; the
 * three strings are the shelves that are not rows in the database — everything,
 * the starred flag, and the documents filed nowhere.
 */
export type Selection = 'all' | 'favorites' | 'others' | number

export function CategoryRail({
  categories,
  selected,
  onSelect,
  counts,
  onDropDoc,
  onCreate,
  onRename,
  onDelete
}: {
  categories: CategoryRow[]
  selected: Selection
  onSelect: (s: Selection) => void
  counts: { all: number; favorites: number; others: number }
  onDropDoc: (docId: number, target: Selection) => void
  onCreate: (name: string) => void
  onRename: (id: number, name: string) => void
  onDelete: (id: number) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <nav className="cat-rail" aria-label="Shelves">
      <Row
        label="All documents"
        shelf="all"
        count={counts.all}
        active={selected === 'all'}
        onSelect={() => onSelect('all')}
      />
      <Row
        label="Favourites"
        icon="star"
        shelf="favorites"
        count={counts.favorites}
        active={selected === 'favorites'}
        onSelect={() => onSelect('favorites')}
        onDropDoc={(id) => onDropDoc(id, 'favorites')}
      />

      <hr className="cat-rule" />

      {categories.map((c) =>
        editing === c.id ? (
          <NameField
            key={c.id}
            initial={c.name}
            onCommit={(name) => {
              onRename(c.id, name)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Row
            key={c.id}
            label={c.name}
            shelf={`category-${c.id}`}
            count={c.docCount}
            active={selected === c.id}
            onSelect={() => onSelect(c.id)}
            onDropDoc={(id) => onDropDoc(id, c.id)}
            onRename={() => setEditing(c.id)}
            onDelete={() => onDelete(c.id)}
          />
        )
      )}

      {adding ? (
        <NameField
          initial=""
          onCommit={(name) => {
            onCreate(name)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button className="cat-new" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          New category
        </button>
      )}

      <hr className="cat-rule" />

      <Row
        label="Others"
        shelf="others"
        count={counts.others}
        active={selected === 'others'}
        onSelect={() => onSelect('others')}
        onDropDoc={(id) => onDropDoc(id, 'others')}
      />
    </nav>
  )
}

function Row({
  label,
  icon,
  shelf,
  count,
  active,
  onSelect,
  onDropDoc,
  onRename,
  onDelete
}: {
  label: string
  icon?: 'star'
  shelf: string
  count: number
  active: boolean
  onSelect: () => void
  onDropDoc?: (docId: number) => void
  onRename?: () => void
  onDelete?: () => void
}): React.JSX.Element {
  const [over, setOver] = useState(false)

  const dropProps = onDropDoc
    ? {
        onDragOver: (e: React.DragEvent) => {
          // Without preventDefault on dragover the browser refuses the drop
          // entirely, and the row would look like a target that does nothing.
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move' as const
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          setOver(false)
          const id = Number(e.dataTransfer.getData('application/x-marmalade-doc'))
          if (Number.isInteger(id) && id > 0) onDropDoc(id)
        }
      }
    : {}

  return (
    <div
      className={`cat-row${active ? ' active' : ''}${over ? ' drop-active' : ''}`}
      // A stable hook for the harnesses in scripts/, which cannot address these
      // rows by text the way they do buttons.
      data-shelf={shelf}
      role="button"
      tabIndex={0}
      aria-current={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect()
      }}
      {...dropProps}
    >
      {icon && <Icon name={icon} size={13} />}
      <span className="cat-name">{label}</span>

      {/* The count steps aside for the edit controls rather than sitting beside
          them, so the row never grows wide enough to wrap on hover. */}
      <span className="cat-count">{count}</span>
      {(onRename || onDelete) && (
        <span className="cat-edit">
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
              title={`Rename ${label}`}
              aria-label={`Rename ${label}`}
            >
              <Icon name="open" size={12} />
            </button>
          )}
          {onDelete && (
            <button
              className="destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              title={`Delete ${label}`}
              aria-label={`Delete ${label}`}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/** The inline field that both creating and renaming a shelf use. */
function NameField({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    const name = value.trim()
    if (name === '' || name === initial) onCancel()
    else onCommit(name)
  }

  return (
    <input
      ref={ref}
      className="cat-field"
      value={value}
      maxLength={48}
      placeholder="Name this shelf"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}
