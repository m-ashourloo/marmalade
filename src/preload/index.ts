import { contextBridge, ipcRenderer } from 'electron'
import type {
  DocumentMeta,
  DocumentRow,
  ExportResult,
  Highlight,
  HighlightPatch,
  ImportPreview,
  ImportResult,
  LabelRow,
  NewHighlight,
  NewHighlightGroup,
  OpenedDocument,
  PageTextRow,
  ReadingPrefs,
  ThumbnailRow
} from '../shared/types'

// A narrow, verb-shaped surface. Deliberately NOT a generic invoke(channel, ...)
// passthrough, which would re-expose every main-process handler to any injected script.
const api = {
  library: {
    list: (): Promise<DocumentRow[]> => ipcRenderer.invoke('library:list'),
    openDialog: (): Promise<string | null> => ipcRenderer.invoke('library:openDialog'),
    forget: (docId: number): Promise<void> => ipcRenderer.invoke('library:forget', docId),
    revealInExplorer: (docId: number): Promise<void> =>
      ipcRenderer.invoke('library:revealInExplorer', docId)
  },
  doc: {
    open: (path: string): Promise<OpenedDocument> => ipcRenderer.invoke('doc:open', path),
    readBytes: (docId: number): Promise<ArrayBuffer> => ipcRenderer.invoke('doc:readBytes', docId),
    updateMeta: (docId: number, meta: DocumentMeta): Promise<void> =>
      ipcRenderer.invoke('doc:updateMeta', docId, meta),
    savePosition: (
      docId: number,
      pos: { page: number; scroll: number; zoom: number }
    ): Promise<void> => ipcRenderer.invoke('doc:savePosition', docId, pos),
    getPageText: (docId: number): Promise<PageTextRow[]> =>
      ipcRenderer.invoke('doc:getPageText', docId),
    putPageText: (docId: number, pages: PageTextRow[]): Promise<void> =>
      ipcRenderer.invoke('doc:putPageText', docId, pages),
    getThumbnail: (docId: number): Promise<ThumbnailRow | null> =>
      ipcRenderer.invoke('doc:getThumbnail', docId),
    putThumbnail: (
      docId: number,
      thumb: { page: number; width: number; height: number; image: Uint8Array }
    ): Promise<void> => ipcRenderer.invoke('doc:putThumbnail', docId, thumb)
  },
  annotations: {
    listByDoc: (docId: number): Promise<Highlight[]> => ipcRenderer.invoke('ann:listByDoc', docId),
    createHl: (input: NewHighlight): Promise<Highlight> => ipcRenderer.invoke('ann:createHl', input),
    /** Writes one selection: a page-part per page it crossed, sharing a group id. */
    createGroup: (input: NewHighlightGroup): Promise<Highlight[]> =>
      ipcRenderer.invoke('ann:createGroup', input),
    // These three address a selection through any of its rows and answer with
    // every row affected, so the caller can update the whole group at once.
    updateHl: (id: number, patch: HighlightPatch): Promise<Highlight[]> =>
      ipcRenderer.invoke('ann:updateHl', id, patch),
    deleteHl: (id: number): Promise<number[]> => ipcRenderer.invoke('ann:deleteHl', id),
    upsertNote: (highlightId: number, body: string): Promise<Highlight[]> =>
      ipcRenderer.invoke('ann:upsertNote', highlightId, body),
    /** Replaces the whole label set on a selection; [] clears it. */
    setLabels: (highlightId: number, names: string[]): Promise<Highlight[]> =>
      ipcRenderer.invoke('ann:setLabels', highlightId, names),
    /** The library-wide label vocabulary, not just this document's. */
    listLabels: (): Promise<LabelRow[]> => ipcRenderer.invoke('ann:listLabels')
  },
  transfer: {
    buildExport: (docId: number): Promise<string> =>
      ipcRenderer.invoke('transfer:buildExport', docId),
    saveExport: (docId: number): Promise<ExportResult> =>
      ipcRenderer.invoke('transfer:saveExport', docId),
    /** Opens a file dialog and returns the chosen file TEXT, never its path. */
    pickImportFile: (): Promise<string | null> =>
      ipcRenderer.invoke('transfer:pickImportFile'),
    inspect: (text: string): Promise<ImportPreview> =>
      ipcRenderer.invoke('transfer:inspect', text),
    apply: (text: string, docId: number): Promise<ImportResult> =>
      ipcRenderer.invoke('transfer:apply', text, docId)
  },
  settings: {
    getReading: (): Promise<ReadingPrefs> => ipcRenderer.invoke('settings:getReading'),
    setReading: (prefs: ReadingPrefs): Promise<void> =>
      ipcRenderer.invoke('settings:setReading', prefs)
  },
  /** Returns an unsubscribe function — React StrictMode double-mounts otherwise leak listeners. */
  onOpenFile: (cb: (path: string) => void): (() => void) => {
    const handler = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on('app:openFile', handler)
    return () => {
      ipcRenderer.off('app:openFile', handler)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
