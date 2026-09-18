import { useCallback, useEffect, useState } from 'react'
import type { DocumentRow } from '@shared/types'
import { Icon } from '../ui/Icon'
import { useThumbnails } from './useThumbnails'
import type { Thumbnail } from './useThumbnails'

export function useLibrary(): {
  docs: DocumentRow[]
  refresh: () => Promise<void>
  forget: (id: number) => Promise<void>
} {
  const [docs, setDocs] = useState<DocumentRow[]>([])

  const refresh = useCallback(async () => {
    setDocs(await window.api.library.list())
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

  return { docs, refresh, forget }
}

export function LibraryView({
  docs,
  onOpen,
  onOpenDialog,
  onImport,
  onForget
}: {
  docs: DocumentRow[]
  onOpen: (doc: DocumentRow) => void
  onOpenDialog: () => void
  onImport: () => void
  onForget: (id: number) => void
}): React.JSX.Element {
  const thumbs = useThumbnails(docs)

  // The most recent document leads, because the job of this screen is getting
  // back into what you were reading. A missing file cannot be resumed, so it
  // stays in the shelf with the rest.
  const hero = docs[0] && !docs[0].missing ? docs[0] : null
  const shelf = hero ? docs.slice(1) : docs

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
          <>
            {hero && (
              <ResumeCard
                doc={hero}
                thumb={thumbs[hero.id]}
                onOpen={() => onOpen(hero)}
                onForget={() => onForget(hero.id)}
              />
            )}

            {shelf.length > 0 && (
              <>
                <h2 className="shelf-head">{hero ? 'Earlier' : 'Your documents'}</h2>
                <div className="lib-grid">
                  {shelf.map((doc) => (
                    <ShelfCard
                      key={doc.id}
                      doc={doc}
                      thumb={thumbs[doc.id]}
                      onOpen={() => onOpen(doc)}
                      onForget={() => onForget(doc.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ResumeCard({
  doc,
  thumb,
  onOpen,
  onForget
}: {
  doc: DocumentRow
  thumb: Thumbnail | undefined
  onOpen: () => void
  onForget: () => void
}): React.JSX.Element {
  const read = progressOf(doc)
  return (
    // Carries .lib-card as well as .resume: it is still a library card, and the
    // harnesses in scripts/ address the first one to open a document.
    <div
      className="lib-card resume"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => activateOnKey(e, onOpen)}
      title={doc.path}
    >
      {/* The hero shows its progress beside the stats, so the thumb stays clean. */}
      <Thumb doc={doc} thumb={thumb} progress={null} />

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
            <CardActions doc={doc} onForget={onForget} />
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
  onOpen,
  onForget
}: {
  doc: DocumentRow
  thumb: Thumbnail | undefined
  onOpen: () => void
  onForget: () => void
}): React.JSX.Element {
  const open = (): void => {
    if (!doc.missing) onOpen()
  }
  return (
    <div
      className={`lib-card${doc.missing ? ' missing' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => activateOnKey(e, open)}
      title={doc.path}
    >
      <Thumb doc={doc} thumb={thumb} progress={progressOf(doc)} />
      <div className="name">{doc.title ?? doc.path}</div>
      {doc.missing && <div className="badge">File not found</div>}
      <div className="sub">{formatWhen(doc.lastOpenedAt)}</div>
      <div className="lib-actions">
        <CardActions doc={doc} onForget={onForget} />
      </div>
    </div>
  )
}

function CardActions({
  doc,
  onForget
}: {
  doc: DocumentRow
  onForget: () => void
}): React.JSX.Element {
  return (
    <>
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
  progress
}: {
  doc: DocumentRow
  thumb: Thumbnail | undefined
  progress: number | null
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
      {progress !== null && (
        <span className="progress">
          <i style={{ '--p': progress } as React.CSSProperties} />
        </span>
      )}
    </span>
  )
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
