import { existsSync } from 'node:fs'
import { ipcMain, dialog, shell } from 'electron'
import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import * as documents from '../db/repos/documents'
import * as categories from '../db/repos/categories'
import { zCategoryName, zId } from './schemas'
import type { CategoryRow, DocumentRow } from '../../shared/types'

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

  // Shelves. Every mutation answers with the whole list because each one moves a
  // count the rail is already showing, and a second round trip to fetch it would
  // let the rail render a stale number in between.
  ipcMain.handle('library:listCategories', (): CategoryRow[] => categories.listAll())

  ipcMain.handle('library:createCategory', (_e, rawName: unknown): CategoryRow[] => {
    categories.create(zCategoryName.parse(rawName))
    return categories.listAll()
  })

  ipcMain.handle('library:renameCategory', (_e, rawId: unknown, rawName: unknown): CategoryRow[] => {
    categories.rename(zId.parse(rawId), zCategoryName.parse(rawName))
    return categories.listAll()
  })

  ipcMain.handle('library:deleteCategory', (_e, rawId: unknown): CategoryRow[] => {
    categories.remove(zId.parse(rawId))
    return categories.listAll()
  })

  ipcMain.handle('library:setCategory', (_e, rawDocId: unknown, rawCatId: unknown): CategoryRow[] => {
    const categoryId = zId.nullable().parse(rawCatId)
    // A category deleted in another window would otherwise leave the document
    // pointing at nothing; treating it as Others is the same outcome the foreign
    // key would have produced.
    documents.setCategory(
      zId.parse(rawDocId),
      categoryId !== null && categories.exists(categoryId) ? categoryId : null
    )
    return categories.listAll()
  })

  ipcMain.handle('library:setFavorite', (_e, rawId: unknown, rawOn: unknown): void => {
    documents.setFavorite(zId.parse(rawId), z.boolean().parse(rawOn))
  })
}
