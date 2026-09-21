import { useEffect, useRef, useState } from 'react'
import type { CategoryRow } from '@shared/types'
import { Icon } from '../ui/Icon'

/**
 * The shelf picker hanging off a card's "Move to…" button. It offers the shelves
 * that exist, Others to unfile, and a field that creates one — typing a name
 * that already exists files the document there rather than erroring.
 */
export function MoveToMenu({
  categories,
  current,
  onPick,
  onCreate,
  onClose
}: {
  categories: CategoryRow[]
  current: number | null
  onPick: (categoryId: number | null) => void
  onCreate: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Capture, so the card underneath does not treat the closing click as a
    // request to open the document.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const create = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    onCreate(trimmed)
  }

  return (
    <div className="move-menu" ref={ref} role="menu" onClick={(e) => e.stopPropagation()}>
      {categories.map((c) => (
        <button
          key={c.id}
          role="menuitem"
          className={c.id === current ? 'on' : undefined}
          onClick={() => onPick(c.id)}
        >
          {c.name}
        </button>
      ))}

      <button
        role="menuitem"
        className={current === null ? 'on' : undefined}
        onClick={() => onPick(null)}
      >
        Others
      </button>

      <div className="move-new">
        <input
          value={name}
          maxLength={48}
          placeholder="New category"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
          }}
        />
        <button onClick={create} disabled={name.trim() === ''} aria-label="Create and move here">
          <Icon name="plus" size={13} />
        </button>
      </div>
    </div>
  )
}
