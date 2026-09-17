import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentRow, Highlight, HighlightColor, NormRect } from '@shared/types'
import { usePdfDocument } from './pdf/usePdfDocument'
import { PdfViewer } from './pdf/PdfViewer'
import type { ViewerHandle } from './pdf/PdfViewer'
import { OutlinePanel } from './pdf/OutlinePanel'
import { boundingBox } from './pdf/geometry'
import { useHighlights } from './annotations/useHighlights'
import { AnnotationSidebar } from './annotations/AnnotationSidebar'
import { useSearch } from './search/useSearch'
import { SearchPanel } from './search/SearchPanel'
import { LibraryView, useLibrary } from './library/LibraryView'
import { useReadingPrefs } from './theme/useReadingPrefs'
import { ReadingModePopover } from './theme/ReadingModePopover'
import { ImportModal } from './transfer/ImportModal'

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
type Tab = 'notes' | 'outline' | 'search'

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<DocumentRow | null>(null)
  const [scale, setScale] = useState(1.25)
  const [rotation, setRotation] = useState(0)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [tab, setTab] = useState<Tab>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [activeHighlightId, setActiveHighlightId] = useState<number | null>(null)
  const [pendingColor, setPendingColor] = useState<HighlightColor>('yellow')
  const [error, setError] = useState<string | null>(null)

  const viewerRef = useRef<ViewerHandle | null>(null)
  const scrollFraction = useRef(0)
  const restored = useRef(false)

  const [prefs, setPrefs] = useReadingPrefs()
  const library = useLibrary()
  const { doc: loaded, loading, error: loadError } = usePdfDocument(doc?.id ?? null)
  const highlights = useHighlights(doc?.id ?? null)

  const pageBoxes = useMemo(() => loaded?.pageSizes.map((s) => s.view) ?? [], [loaded])
  const search = useSearch(doc?.id ?? null, loaded?.pdf ?? null, pageBoxes)

  // ---- opening documents --------------------------------------------------
  const openPath = useCallback(
    async (path: string) => {
      try {
        const { doc: opened } = await window.api.doc.open(path)
        restored.current = false
        setDoc(opened)
        setPage(opened.lastPage)
        setPageDraft(String(opened.lastPage))
        if (opened.lastZoom) setScale(opened.lastZoom)
        void library.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [library]
  )

  const openDialog = useCallback(async () => {
    const path = await window.api.library.openDialog()
    if (path) await openPath(path)
  }, [openPath])

  // A .pdf double-clicked in Explorer, or passed on the command line.
  useEffect(() => window.api.onOpenFile((path) => void openPath(path)), [openPath])

  // Without this, a file dropped anywhere but the import drop zone makes Chromium
  // navigate the renderer to it, replacing the whole app with the file.
  useEffect(() => {
    const swallow = (e: DragEvent): void => e.preventDefault()
    document.addEventListener('dragover', swallow)
    document.addEventListener('drop', swallow)
    return () => {
      document.removeEventListener('dragover', swallow)
      document.removeEventListener('drop', swallow)
    }
  }, [])

  // Restore the reading position once the document's pages are measured.
  useEffect(() => {
    if (!loaded || !doc || restored.current) return
    restored.current = true
    viewerRef.current?.scrollToPage(doc.lastPage, doc.lastScroll ?? 0)
  }, [loaded, doc])

  useEffect(() => {
    if (loadError) setError(loadError)
  }, [loadError])

  // ---- persisting position ------------------------------------------------
  const onPositionChange = useCallback((p: number, fraction: number) => {
    setPage(p)
    setPageDraft(String(p))
    scrollFraction.current = fraction
  }, [])

  // Saved shortly after the position actually changes, rather than on a timer:
  // an abrupt close (or a crash) then loses at most the last moment of reading,
  // not up to a whole interval.
  useEffect(() => {
    if (!doc) return
    const save = (): void => {
      void window.api.doc.savePosition(doc.id, {
        page,
        scroll: scrollFraction.current,
        zoom: scale
      })
    }
    const id = window.setTimeout(save, 700)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [doc, page, scale])

  // ---- highlight actions --------------------------------------------------
  const createHighlight = useCallback(
    (p: number, rects: NormRect[], text: string, color: HighlightColor) => {
      if (!doc) return
      setPendingColor(color)
      void highlights
        .create({ docId: doc.id, page: p, color, rects, quotedText: text })
        .then((h) => h && setActiveHighlightId(h.id))
    },
    [doc, highlights]
  )

  const exportNotes = useCallback(async () => {
    if (!doc) return
    try {
      const result = await window.api.transfer.saveExport(doc.id)
      if (result.saved) setError(`Exported ${result.count} highlights to ${result.path}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [doc])

  const gotoHighlight = useCallback((h: Highlight) => {
    setActiveHighlightId(h.id)
    const box = boundingBox(h.rects)
    if (box) viewerRef.current?.scrollToRect(h.page, box)
  }, [])

  const onHighlightClick = useCallback(
    (id: number) => {
      setActiveHighlightId(id)
      setTab('notes')
      setSidebarOpen(true)
      // Bring the matching sidebar entry into view.
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-ann="${id}"]`)?.scrollIntoView({ block: 'nearest' })
      })
    },
    []
  )

  // ---- search navigation --------------------------------------------------
  const goToHit = useCallback(
    (index: number) => {
      search.goTo(index)
      const hit = search.hits[index]
      if (!hit) return
      const box = boundingBox(hit.rects)
      if (box) viewerRef.current?.scrollToRect(hit.page, box)
      else viewerRef.current?.scrollToPage(hit.page)
    },
    [search]
  )

  // Keep the viewport on the current search hit as it changes via Enter / F3.
  const lastHitId = useRef<string | null>(null)
  useEffect(() => {
    const hit = search.current
    if (!hit || hit.id === lastHitId.current) return
    lastHitId.current = hit.id
    const box = boundingBox(hit.rects)
    if (box) viewerRef.current?.scrollToRect(hit.page, box)
  }, [search.current])

  // ---- keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA'].includes(e.target.tagName)

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openDialog()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setTab('search')
        setSidebarOpen(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(1)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        zoomBy(-1)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        setScale(1)
        return
      }
      if (typing) return
      if (e.key === 'F3') {
        e.preventDefault()
        if (e.shiftKey) search.prev()
        else search.next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDialog, search])

  const zoomBy = (direction: 1 | -1): void => {
    setScale((current) => {
      const i = ZOOM_STEPS.findIndex((z) => z >= current - 1e-6)
      const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i === -1 ? 3 : i) + direction))
      return ZOOM_STEPS[next]
    })
  }

  // ---- render -------------------------------------------------------------
  if (!doc) {
    return (
      <div className="app">
        <LibraryView
          docs={library.docs}
          onOpen={(d) => void openPath(d.path)}
          onOpenDialog={() => void openDialog()}
          onImport={() => setImportOpen(true)}
          onForget={(id) => void library.forget(id)}
        />
        {importOpen && (
          <ImportModal
            openDoc={null}
            onClose={() => setImportOpen(false)}
            onImported={() => void library.refresh()}
          />
        )}
        {error && <Toast message={error} onDismiss={() => setError(null)} />}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button
          onClick={() => {
            setDoc(null)
            void library.refresh()
          }}
          title="Back to library"
        >
          ← Library
        </button>
        <button onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
          ☰
        </button>
        <span className="divider" />
        <span className="doc-title" title={doc.path}>
          {doc.title ?? doc.path}
        </span>

        <span className="spacer" />

        <button onClick={() => viewerRef.current?.scrollToPage(Math.max(1, page - 1))} title="Previous page">
          ‹
        </button>
        <input
          className="page-input"
          type="text"
          value={pageDraft}
          onChange={(e) => setPageDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const n = Number(pageDraft)
            if (Number.isFinite(n) && n >= 1 && loaded && n <= loaded.pdf.numPages) {
              viewerRef.current?.scrollToPage(n)
            } else {
              setPageDraft(String(page))
            }
          }}
        />
        <span style={{ color: 'var(--text-dim)' }}>/ {loaded?.pdf.numPages ?? '…'}</span>
        <button onClick={() => viewerRef.current?.scrollToPage(page + 1)} title="Next page">
          ›
        </button>

        <span className="divider" />
        <button onClick={() => zoomBy(-1)} title="Zoom out (Ctrl -)">−</button>
        <span style={{ minWidth: '4.5ch', textAlign: 'center', color: 'var(--text-dim)' }}>
          {Math.round(scale * 100)}%
        </span>
        <button onClick={() => zoomBy(1)} title="Zoom in (Ctrl +)">+</button>
        <button onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate">
          ⟳
        </button>

        <span className="divider" />
        <button onClick={() => setPrefsOpen((v) => !v)} title="Reading mode">
          ◐ {prefs.mode === 'normal' ? 'Normal' : prefs.mode === 'dark' ? 'Dark' : 'Sepia'}
        </button>

        <span className="divider" />
        <button onClick={() => setImportOpen(true)} title="Import highlights and notes">
          ⤒ Import
        </button>
        <button
          onClick={() => void exportNotes()}
          disabled={highlights.all.length === 0}
          title={
            highlights.all.length === 0
              ? 'Nothing to export yet'
              : 'Export highlights and notes'
          }
        >
          ⤓ Export
        </button>

        {prefsOpen && (
          <ReadingModePopover prefs={prefs} onChange={setPrefs} onClose={() => setPrefsOpen(false)} />
        )}
      </div>

      <div className="workspace">
        {sidebarOpen && (
          <div className="sidebar">
            <div className="sidebar-tabs">
              <button aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>
                Notes {highlights.all.length > 0 && `(${highlights.all.length})`}
              </button>
              <button aria-selected={tab === 'outline'} onClick={() => setTab('outline')}>
                Outline
              </button>
              <button aria-selected={tab === 'search'} onClick={() => setTab('search')}>
                Search
              </button>
            </div>

            {tab === 'search' ? (
              <SearchPanel search={search} onGoToHit={goToHit} />
            ) : (
              <div className="sidebar-body">
                {tab === 'notes' && (
                  <AnnotationSidebar
                    highlights={highlights.all}
                    activeId={activeHighlightId}
                    onSelect={gotoHighlight}
                    onSetColor={(id, c) => void highlights.setColor(id, c)}
                    onSetNote={(id, b) => void highlights.setNote(id, b)}
                    onDelete={(id) => {
                      void highlights.remove(id)
                      if (activeHighlightId === id) setActiveHighlightId(null)
                    }}
                  />
                )}
                {tab === 'outline' && loaded && (
                  <OutlinePanel
                    pdf={loaded.pdf}
                    onNavigate={(p, y) => viewerRef.current?.scrollToPage(p, y)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {loading && <div className="sidebar-empty" style={{ flex: 1 }}>Loading document…</div>}

        {loaded && (
          <PdfViewer
            doc={loaded}
            scale={scale}
            rotation={rotation}
            mode={prefs.mode}
            highlightsByPage={highlights.byPage}
            searchHitsByPage={search.hitsByPage}
            currentHitId={search.current?.id ?? null}
            activeHighlightId={activeHighlightId}
            pendingColor={pendingColor}
            onCreateHighlight={createHighlight}
            onHighlightClick={onHighlightClick}
            onPositionChange={onPositionChange}
            handleRef={viewerRef}
          />
        )}
      </div>

      {importOpen && (
        <ImportModal
          openDoc={{ id: doc.id, title: doc.title ?? doc.path }}
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            if (result.docId === doc.id) void highlights.reload()
          }}
        />
      )}

      {error && <Toast message={error} onDismiss={() => setError(null)} />}
    </div>
  )
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }): React.JSX.Element {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 7000)
    return () => window.clearTimeout(id)
  }, [onDismiss])
  return (
    <div className="toast" onClick={onDismiss}>
      {message}
    </div>
  )
}
