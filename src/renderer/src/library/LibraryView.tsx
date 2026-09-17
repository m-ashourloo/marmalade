import { useCallback, useEffect, useState } from 'react'
import type { DocumentRow } from '@shared/types'

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
  return (
    <div className="library">
      <h1>Marmalade</h1>
      <p className="subtitle">
        Highlights and notes are stored separately — your PDF files are never modified.
      </p>

      <div style={{ marginBottom: 26, display: 'flex', gap: 8 }}>
        <button className="primary" onClick={onOpenDialog}>
          Open a PDF…
        </button>
        <button onClick={onImport} title="Import highlights and notes">
          ⤒ Import notes…
        </button>
      </div>

      {docs.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>
          Nothing here yet. Open a PDF to get started — it will appear in this list next time.
        </p>
      ) : (
        <>
          <h2 style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 600 }}>Recent</h2>
          <div className="lib-grid">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className={`lib-card${doc.missing ? ' missing' : ''}`}
                onClick={() => !doc.missing && onOpen(doc)}
                title={doc.path}
              >
                <div className="name">{doc.title ?? doc.path}</div>
                {doc.missing && <div className="badge">File not found</div>}
                <div className="sub">
                  {doc.pageCount > 0 && <>Page {doc.lastPage} of {doc.pageCount} · </>}
                  {formatWhen(doc.lastOpenedAt)}
                </div>
                <div>
                  <button
                    style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text-dim)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onForget(doc.id)
                    }}
                    title="Remove from this list, along with its highlights and notes"
                  >
                    Remove
                  </button>
                  {!doc.missing && (
                    <button
                      style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text-dim)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.library.revealInExplorer(doc.id)
                      }}
                    >
                      Show in folder
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
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
