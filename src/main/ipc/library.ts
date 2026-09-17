import { existsSync } from 'node:fs'
import { ipcMain, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import * as documents from '../db/repos/documents'
import { zId } from './schemas'
import type { DocumentRow } from '../../shared/types'

export function registerLibraryHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('library:list', (): DocumentRow[] => {
    const docs = documents.listRecent()
    // Refresh the "missing" flag lazily, on read.
    for (const d of docs) {
      const gone = !existsSync(d.path)
      if (gone !== d.missing) {
        documents.markMissing(d.id, gone)
        d.missing = gone
      }
    }
    return docs
  })

  ipcMain.handle('library:openDialog', async (): Promise<string | null> => {
    const win = getWindow()
    const opts = {
      title: 'Open PDF',
      properties: ['openFile' as const],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:forget', (_e, rawId: unknown) => {
    documents.remove(zId.parse(rawId))
  })

  ipcMain.handle('library:revealInExplorer', (_e, rawId: unknown) => {
    const doc = documents.getById(zId.parse(rawId))
    if (doc && existsSync(doc.path)) shell.showItemInFolder(doc.path)
  })
}
