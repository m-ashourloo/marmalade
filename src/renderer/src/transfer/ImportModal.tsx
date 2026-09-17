import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportPreview, ImportResult } from '@shared/types'

export interface ImportModalProps {
  /** The document currently open, if any — the fallback target when the file's
   *  PDF is not in the library. */
  openDoc: { id: number; title: string } | null
  onClose: () => void
  /** Fired after a successful import, with the document the rows landed in. */
  onImported: (result: ImportResult) => void
}

type Stage =
  | { kind: 'empty' }
  | { kind: 'busy' }
  | { kind: 'preview'; text: string; preview: ImportPreview }
  | { kind: 'done'; result: ImportResult }

export function ImportModal({ openDoc, onClose, onImported }: ImportModalProps): React.JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: 'empty' })
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Same dismissal contract as ReadingModePopover: Escape, or a click outside.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const accept = useCallback(async (text: string) => {
    setError(null)
    setStage({ kind: 'busy' })
    try {
      const preview = await window.api.transfer.inspect(text)
      setStage({ kind: 'preview', text, preview })
    } catch (err) {
      setError(messageOf(err))
      setStage({ kind: 'empty' })
    }
  }, [])

  const pick = useCallback(async () => {
    const text = await window.api.transfer.pickImportFile()
    if (text !== null) await accept(text)
  }, [accept])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      // Electron 44 no longer exposes File.path, and it isn't needed: the text is
      // the whole payload, and reading it here keeps the renderer sandboxed.
      void file.text().then(accept)
    },
    [accept]
  )

  const run = useCallback(
    async (text: string, docId: number) => {
      setStage({ kind: 'busy' })
      try {
        const result = await window.api.transfer.apply(text, docId)
        setStage({ kind: 'done', result })
        onImported(result)
      } catch (err) {
        setError(messageOf(err))
        setStage({ kind: 'empty' })
      }
    },
    [onImported]
  )

  return (
    <div className="modal-overlay">
      <div className="modal" ref={cardRef} role="dialog" aria-modal="true" aria-label="Import highlights and notes">
        <h3>Import highlights and notes</h3>

        {(stage.kind === 'empty' || stage.kind === 'busy') && (
          <>
            <div
              className={`dropzone${dragOver ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              {stage.kind === 'busy' ? (
                <p>Reading…</p>
              ) : (
                <>
                  <p className="dropzone-main">Drop a .mmnotes.json file here</p>
                  <p className="dropzone-hint">exported from Marmalade</p>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" onClick={() => void pick()} disabled={stage.kind === 'busy'}>
                Select file…
              </button>
            </div>
          </>
        )}

        {stage.kind === 'preview' && (
          <Preview
            preview={stage.preview}
            openDoc={openDoc}
            onCancel={onClose}
            onConfirm={(docId) => void run(stage.text, docId)}
          />
        )}

        {stage.kind === 'done' && (
          <>
            <p className="import-summary">
              Added <strong>{stage.result.added}</strong>{' '}
              {stage.result.added === 1 ? 'highlight' : 'highlights'}
              {stage.result.notesAdded > 0 && (
                <>
                  {' '}
                  and {stage.result.notesAdded}{' '}
                  {stage.result.notesAdded === 1 ? 'note' : 'notes'}
                </>
              )}
              .
            </p>
            {stage.result.skippedDuplicate > 0 && (
              <p className="import-note">
                Skipped {stage.result.skippedDuplicate} already present.
              </p>
            )}
            {stage.result.skippedOutOfRange > 0 && (
              <p className="import-note">
                Skipped {stage.result.skippedOutOfRange} pointing past the last page.
              </p>
            )}
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {error && <p className="import-error">{error}</p>}
      </div>
    </div>
  )
}

function Preview({
  preview,
  openDoc,
  onCancel,
  onConfirm
}: {
  preview: ImportPreview
  openDoc: { id: number; title: string } | null
  onCancel: () => void
  onConfirm: (docId: number) => void
}): React.JSX.Element {
  const { document: src, highlightCount, noteCount, match } = preview
  const name = src.title ?? src.fileName

  return (
    <>
      <p className="import-summary">
        <strong>{name}</strong>
        <br />
        {highlightCount} {highlightCount === 1 ? 'highlight' : 'highlights'}
        {noteCount > 0 && <>, {noteCount === 1 ? '1 with a note' : `${noteCount} with notes`}</>}
      </p>

      {match.kind === 'exact' ? (
        <>
          <p className="import-note">
            Matches <strong>{match.title}</strong> in your library.
          </p>
          <div className="modal-actions">
            <button onClick={onCancel}>Cancel</button>
            <button className="primary" onClick={() => onConfirm(match.docId)}>
              Import
            </button>
          </div>
        </>
      ) : openDoc ? (
        <>
          <p className="import-warn">
            That PDF isn&apos;t in your library. You can add these to{' '}
            <strong>{openDoc.title}</strong> instead, but if it isn&apos;t the same
            document the highlights will land in the wrong places.
          </p>
          <div className="modal-actions">
            <button onClick={onCancel}>Cancel</button>
            <button className="primary" onClick={() => onConfirm(openDoc.id)}>
              Import into {openDoc.title} anyway
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="import-warn">
            That PDF isn&apos;t in your library. Open <strong>{src.fileName}</strong>{' '}
            first, then import again.
          </p>
          <div className="modal-actions">
            <button className="primary" onClick={onCancel}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  )
}

/** IPC rejections arrive prefixed with the handler frame — show only the message. */
function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}
