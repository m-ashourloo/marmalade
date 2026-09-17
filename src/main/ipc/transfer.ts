import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import * as documents from '../db/repos/documents'
import * as highlights from '../db/repos/highlights'
import { buildBundle, exportFileName, parseBundle } from '../transfer/format'
import { zBundleText, zId } from './schemas'
import type { ExportResult, ImportPreview, ImportResult } from '../../shared/types'

const EXT = 'mmnotes.json'

function bundleTextFor(docId: number): { text: string; count: number; title: string } {
  const doc = documents.getById(docId)
  if (!doc) throw new Error('Unknown document')
  const list = highlights.listByDoc(docId)
  const bundle = buildBundle(doc, list)
  return {
    text: JSON.stringify(bundle, null, 2),
    count: list.length,
    title: doc.title ?? basename(doc.path, '.pdf')
  }
}

/**
 * Export and import are each split in two: a pure half that neither reads nor
 * writes the disk, and a half that opens a native dialog. The dialogs are
 * OS-modal and block the CDP driver, so the split is what keeps the format and
 * the merge logic drivable end to end.
 */
export function registerTransferHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('transfer:buildExport', (_e, rawId: unknown): string => {
    return bundleTextFor(zId.parse(rawId)).text
  })

  ipcMain.handle('transfer:saveExport', async (_e, rawId: unknown): Promise<ExportResult> => {
    const { text, count, title } = bundleTextFor(zId.parse(rawId))
    const win = getWindow()
    const opts = {
      title: 'Export highlights and notes',
      defaultPath: exportFileName(title, EXT),
      filters: [{ name: 'Marmalade annotations', extensions: [EXT] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { saved: false, path: null, count }
    await writeFile(result.filePath, text, 'utf8')
    return { saved: true, path: result.filePath, count }
  })

  /**
   * Returns the file's TEXT, not its path — the renderer's drop handler produces
   * text too, so both routes into the modal converge on one shape and the
   * renderer never learns a filesystem path.
   */
  ipcMain.handle('transfer:pickImportFile', async (): Promise<string | null> => {
    const win = getWindow()
    const opts = {
      title: 'Import highlights and notes',
      properties: ['openFile' as const],
      filters: [{ name: 'Marmalade annotations', extensions: [EXT, 'json'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return readFile(result.filePaths[0], 'utf8')
  })

  /** Parse and resolve the target document. Writes nothing. */
  ipcMain.handle('transfer:inspect', (_e, rawText: unknown): ImportPreview => {
    const bundle = parseBundle(zBundleText.parse(rawText))
    const existing = documents.findBySha(bundle.document.sha256)
    return {
      document: bundle.document,
      highlightCount: bundle.highlights.length,
      noteCount: bundle.highlights.filter((h) => h.note && h.note.trim() !== '').length,
      match: existing
        ? {
            kind: 'exact',
            docId: existing.id,
            title: existing.title ?? basename(existing.path, '.pdf')
          }
        : { kind: 'none' }
    }
  })

  ipcMain.handle('transfer:apply', (_e, rawText: unknown, rawDocId: unknown): ImportResult => {
    const bundle = parseBundle(zBundleText.parse(rawText))
    const docId = zId.parse(rawDocId)
    if (!documents.getById(docId)) throw new Error('Unknown document')
    return highlights.importMany(docId, bundle.highlights)
  })
}
