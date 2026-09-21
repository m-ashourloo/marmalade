import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryRow, DocumentRow } from '@shared/types'
import { Icon } from '../ui/Icon'
import { CategoryRail } from './CategoryRail'
import type { Selection } from './CategoryRail'
import { MoveToMenu } from './MoveToMenu'
import { useThumbnails } from './useThumbnails'
import type { Thumbnail } from './useThumbnails'

export interface LibraryActions {
  docs: DocumentRow[]
  categories: CategoryRow[]
  refresh: () => Promise<void>
  forget: (id: number) => Promise<void>
  setCategory: (docId: number, categoryId: number | null) => Promise<void>
  toggleFavorite: (doc: DocumentRow) => Promise<void>
  createCategory: (name: string) => Promise<void>
  fileUnderNew: (docId: number, name: string) => Promise<void>
  renameCategory: (id: number, name: string) => Promise<void>
  deleteCategory: (id: number) => Promise<void>
}

export function useLibrary(): LibraryActions {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])

  // Both lists move together: filing a document changes a shelf count, so
  // fetching them separately would let the rail and the grid disagree.
  const refresh = useCallback(async () => {
    const [d, c] = await Promise.all([
      window.api.library.list(),
      window.api.library.listCategories()
    ])
    setDocs(d)
    setCategories(c)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const forget = useCallback(
    async (id: number) => {
      await window.api.library.forget(id)
      await refresh()
    },
    [refresh]
  )

  const setCategory = useCallback(
    async (docId: number, categoryId: number | null) => {
      await window.api.library.setCategory(docId, categoryId)
      await refresh()
    },
    [refresh]
  )

  const toggleFavorite = useCallback(
    async (doc: DocumentRow) => {
      await window.api.library.setFavorite(doc.id, !doc.favorite)
      await refresh()
    },
    [refresh]
  )

  const createCategory = useCallback(
    async (name: string) => {
      await window.api.library.createCategory(name)
      await refresh()
    },
    [refresh]
  )

  // Creating a shelf from a card's picker has to land the document on it, and
  // the id only exists once main has written the row — so the fresh list that
  // comes back is where the id is read from.
  const fileUnderNew = useCallback(
    async (docId: number, name: string) => {
      const wanted = name.replace(/\s+/g, ' ').trim().slice(0, 48).toLowerCase()
      const cats = await window.api.library.createCategory(name)
      const made = cats.find((c) => c.name.toLowerCase() === wanted)
      if (made) await window.api.library.setCategory(docId, made.id)
      await refresh()
    },
    [refresh]
  )

  const renameCategory = useCallback(
    async (id: number, name: string) => {
      await window.api.library.renameCategory(id, name)
      await refresh()
    },
    [refresh]
  )

  const deleteCategory = useCallback(
    async (id: number) => {
      await window.api.library.deleteCategory(id)
      await refresh()
    },
    [refresh]
  )

  return {
    docs,
    categories,
    refresh,
    forget,
    setCategory,
    toggleFavorite,
    createCategory,
    fileUnderNew,
    renameCategory,
    deleteCategory
  }
}

export function LibraryView({
  docs,
  categories,
  onOpen,
  onOpenDialog,
  onImport,
  onForget,
  onSetCategory,
  onToggleFavorite,
  onCreateCategory,
  onFileUnderNew,
  onRenameCategory,
  onDeleteCategory
}: {
  docs: DocumentRow[]
  categories: CategoryRow[]
  onOpen: (doc: DocumentRow) => void
  onOpenDialog: () => void
  onImport: () => void
  onForget: (id: number) => void
  onSetCategory: (docId: number, categoryId: number | null) => void
  onToggleFavorite: (doc: DocumentRow) => void
  onCreateCategory: (name: string) => void
  onFileUnderNew: (docId: number, name: string) => void
  onRenameCategory: (id: number, name: string) => void
  onDeleteCategory: (id: number) => void
}): React.JSX.Element {
  const thumbs = useThumbnails(docs)
  const [selected, setSelected] = useState<Selection>('all')

  // A shelf the reader was looking at can disappear — they delete it, or another
  // window does. Falling back to everything beats rendering an empty screen for
  // a shelf that no longer exists.
  useEffect(() => {
    if (typeof selected !== 'number') return
    if (!categories.some((c) => c.id === selected)) setSelected('all')
  }, [categories, selected])

  const counts = useMemo(
    () => ({
      all: docs.length,
      favorites: docs.filter((d) => d.favorite).length,
      others: docs.filter((d) => d.categoryId === null).length
    }),
    [docs]
  )

  const shown = useMemo(() => {
    if (selected === 'all') return docs
    if (selected === 'favorites') return docs.filter((d) => d.favorite)
    if (selected === 'others') return docs.filter((d) => d.categoryId === null)
    return docs.filter((d) => d.categoryId === selected)
  }, [docs, selected])

  // The most recent document leads, because the job of this screen is getting
  // back into what you were reading. A missing file cannot be resumed, so it
  // stays in the shelf with the rest. Only on "All": inside a shelf the reader
  // is browsing rather than resuming, and a hero would push the shelf off-screen.
  const hero = selected === 'all' && shown[0] && !shown[0].missing ? shown[0] : null
  const grid = hero ? shown.slice(1) : shown

  const dropOn = (docId: number, target: Selection): void => {
    const doc = docs.find((d) => d.id === docId)
    if (!doc) return
    if (target === 'favorites') {
      if (!doc.favorite) onToggleFavorite(doc)
      return
    }
    if (target === 'all') return
    onSetCategory(docId, target === 'others' ? null : target)
  }

  const card = (doc: DocumentRow): React.JSX.Element => (
    <ShelfCard
      key={doc.id}
      doc={doc}
      thumb={thumbs[doc.id]}
      categories={categories}
      onOpen={() => onOpen(doc)}
      onForget={() => onForget(doc.id)}
      onSetCategory={(id) => onSetCategory(doc.id, id)}
      onFileUnderNew={(name) => onFileUnderNew(doc.id, name)}
      onToggleFavorite={() => onToggleFavorite(doc)}
    />
  )

  return (
    <div className="library">
      <div className="library-head">
        <h1 className="wordmark">Marmalade</h1>
        <span className="spacer" />
        {/* With nothing in the library there is nothing to import notes onto, and
            the empty state already carries the one call to action. */}
        {docs.length > 0 && (
          <div className="actions">
            <button className="primary" onClick={onOpenDialog}>
              <Icon name="open" />
              Open a PDF
            </button>
            <button className="outline" onClick={onImport} title="Import highlights and notes">
              <Icon name="import" />
              Import notes
            </button>
          </div>
        )}
      </div>

      <div className="library-inner">
        {docs.length === 0 ? (
          <div className="library-empty">
            <h2>Nothing on the shelf yet.</h2>
            <p>
              Open a PDF and Marmalade remembers the page you stopped on, along with every
              highlight and note you leave in it.
            </p>
            <button className="primary" onClick={onOpenDialog}>
              <Icon name="open" />
              Open a PDF
            </button>
          </div>
        ) : (
          <div className="library-body">
            <CategoryRail
              categories={categories}
              selected={selected}
              onSelect={setSelected}
              counts={counts}
              onDropDoc={dropOn}
              onCreate={onCreateCategory}
              onRename={onRenameCategory}
              onDelete={onDeleteCategory}
            />

            <div className="library-shelf">
              {hero && (
                <ResumeCard
                  doc={hero}
                  thumb={thumbs[hero.id]}
                  categories={categories}
                  onOpen={() => onOpen(hero)}
                  onForget={() => onForget(hero.id)}
                  onSetCategory={(id) => onSetCategory(hero.id, id)}
                  onFileUnderNew={(name) => onFileUnderNew(hero.id, name)}
                  onToggleFavorite={() => onToggleFavorite(hero)}
                />
              )}

              {grid.length > 0 && (
                <>
                  <h2 className="shelf-head">
                    {headingFor(selected, categories, hero !== null)}
                  </h2>
                  <div className="lib-grid">{grid.map(card)}</div>
                </>
              )}

              {shown.length === 0 && <ShelfEmpty selected={selected} categories={categories} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ShelfEmpty({
  selected,
  categories
}: {
  selected: Selection
  categories: CategoryRow[]
}): React.JSX.Element {
  const name = nameOf(selected, categories)
  return (
    <div className="shelf-empty">
      <h2>{selected === 'favorites' ? 'No favourites yet.' : `Nothing in ${name} yet.`}</h2>
      <p>
        {selected === 'favorites'
          ? 'Star a document to keep it within reach. Starring does not move it off its shelf.'
          : 'Drag a document here, or use Move to… on any card.'}
      </p>
    </div>
  )
}

function headingFor(selected: Selection, categories: CategoryRow[], hasHero: boolean): string {
  if (selected === 'all') return hasHero ? 'Earlier' : 'Your documents'
  return nameOf(selected, categories)
}

function nameOf(selected: Selection, categories: CategoryRow[]): string {
  if (selected === 'all') return 'Your documents'
  if (selected === 'favorites') return 'Favourites'
  if (selected === 'others') return 'Others'
  return categories.find((c) => c.id === selected)?.name ?? 'This shelf'
}

function ResumeCard({
  doc,
  thumb,
  categories,
  onOpen,
  onForget,
  onSetCategory,
  onFileUnderNew,
  onToggleFavorite
}: CardProps): React.JSX.Element {
  const read = progressOf(doc)
  return (
    // Carries .lib-card as well as .resume: it is still a library card, and the
    // harnesses in scripts/ address the first one to open a document.
    <div
      className="lib-card resume"
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => startDrag(e, doc)}
      onClick={onOpen}
      onKeyDown={(e) => activateOnKey(e, onOpen)}
      title={doc.path}
    >
      {/* The hero shows its progress beside the stats, so the thumb stays clean. */}
      <Thumb doc={doc} thumb={thumb} progress={null} onToggleFavorite={onToggleFavorite} />

      <div>
        <div className="name">{doc.title ?? doc.path}</div>

        <div className="stats">
          {doc.pageCount > 0 && (
            <span>
              Page <b>{doc.lastPage}</b> of <b>{doc.pageCount}</b>
            </span>
          )}
          {doc.highlightCount ? (
            <span>
              <b>{doc.highlightCount}</b> {doc.highlightCount === 1 ? 'highlight' : 'highlights'}
            </span>
          ) : null}
          <span className="when">{formatWhen(doc.lastOpenedAt)}</span>
        </div>

        {read !== null && (
          <div className="progress">
            <i style={{ '--p': read } as React.CSSProperties} />
          </div>
        )}

        <div className="resume-actions">
          <button
            className="primary"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            Continue reading
          </button>
          <div className="lib-actions">
            <CardActions
              doc={doc}
              categories={categories}
              onForget={onForget}
              onSetCategory={onSetCategory}
              onFileUnderNew={onFileUnderNew}
            />
          </div>
        </div>

        <p className="path">{doc.path}</p>
      </div>
    </div>
  )
}

function ShelfCard({
  doc,
  thumb,
  categories,
  onOpen,
  onForget,
  onSetCategory,
  onFileUnderNew,
  onToggleFavorite
}: CardProps): React.JSX.Element {
  const open = (): void => {
    if (!doc.missing) onOpen()
  }
  return (
    <div
      className={`lib-card${doc.missing ? ' missing' : ''}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => startDrag(e, doc)}
      onClick={open}
      onKeyDown={(e) => activateOnKey(e, open)}
      title={doc.path}
    >
      <Thumb
        doc={doc}
        thumb={thumb}
        progress={progressOf(doc)}
        onToggleFavorite={onToggleFavorite}
      />
      <div className="name">{doc.title ?? doc.path}</div>
      {doc.missing && <div className="badge">File not found</div>}
      <div className="sub">{formatWhen(doc.lastOpenedAt)}</div>
      <div className="lib-actions">
        <CardActions
          doc={doc}
          categories={categories}
          onForget={onForget}
          onSetCategory={onSetCategory}
          onFileUnderNew={onFileUnderNew}
        />
      </div>
    </div>
  )
}

interface CardProps {
  doc: DocumentRow
  thumb: Thumbnail | undefined
  categories: CategoryRow[]
  onOpen: () => void
  onForget: () => void
  onSetCategory: (categoryId: number | null) => void
  onFileUnderNew: (name: string) => void
  onToggleFavorite: () => void
}

function CardActions({
  doc,
  categories,
  onForget,
  onSetCategory,
  onFileUnderNew
}: {
  doc: DocumentRow
  categories: CategoryRow[]
  onForget: () => void
  onSetCategory: (categoryId: number | null) => void
  onFileUnderNew: (name: string) => void
}): React.JSX.Element {
  const [moving, setMoving] = useState(false)

  return (
    <>
      <button
        className={moving ? 'on' : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setMoving((v) => !v)
        }}
        title="File this document on a shelf"
      >
        <Icon name="shelf" size={13} />
        Move to…
      </button>
      {moving && (
        <MoveToMenu
          categories={categories}
          current={doc.categoryId}
          onPick={(id) => {
            onSetCategory(id)
            setMoving(false)
          }}
          onCreate={(name) => {
            onFileUnderNew(name)
            setMoving(false)
          }}
          onClose={() => setMoving(false)}
        />
      )}
      <button
        className="destructive"
        onClick={(e) => {
          e.stopPropagation()
          onForget()
        }}
        title="Remove from this list, along with its highlights and notes"
      >
        <Icon name="trash" size={13} />
        Remove
      </button>
      {!doc.missing && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            void window.api.library.revealInExplorer(doc.id)
          }}
        >
          <Icon name="folder" size={13} />
          Show in folder
        </button>
      )}
    </>
  )
}

/** The page the reader stopped on, or ruled lines standing in for one. */
function Thumb({
  doc,
  thumb,
  progress,
  onToggleFavorite
}: {
  doc: DocumentRow
  thumb: Thumbnail | undefined
  progress: number | null
  onToggleFavorite: () => void
}): React.JSX.Element {
  return (
    // The box takes the page's own proportions rather than forcing every document
    // into one rectangle: a landscape slide deck and a portrait paper are
    // different objects, and cropping one to look like the other loses the page.
    <span
      className="thumb"
      style={{ aspectRatio: thumb ? thumb.aspect : 3 / 4 } as React.CSSProperties}
    >
      {thumb ? (
        <img src={thumb.url} alt="" draggable={false} />
      ) : (
        <span className="thumb-fallback">{doc.title ?? 'PDF'}</span>
      )}

      {/* Cream rather than amber: the accent is spoken for, and a starred
          document should not outshout the reader's own highlight colours. */}
      <button
        className={`fav-star${doc.favorite ? ' on' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
        aria-pressed={doc.favorite}
        title={doc.favorite ? 'Remove from favourites' : 'Add to favourites'}
        aria-label={doc.favorite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <Icon name="star" size={14} />
      </button>

      {progress !== null && (
        <span className="progress">
          <i style={{ '--p': progress } as React.CSSProperties} />
        </span>
      )}
    </span>
  )
}

/** A private type, so a card dragged out of the window does not paste a doc id
 *  into whatever text field it lands on. */
function startDrag(e: React.DragEvent, doc: DocumentRow): void {
  e.dataTransfer.setData('application/x-marmalade-doc', String(doc.id))
  e.dataTransfer.effectAllowed = 'move'
}

/** How far through the document the reader is, or null when it is unknown. */
function progressOf(doc: DocumentRow): number | null {
  if (doc.pageCount <= 0) return null
  return Math.min(1, Math.max(0, doc.lastPage / doc.pageCount))
}

function activateOnKey(e: React.KeyboardEvent, run: () => void): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  run()
}

function formatWhen(ts: number | null): string {
  if (!ts) return 'Never opened'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ts).toLocaleDateString()
}
