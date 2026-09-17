import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, resolve as resolvePath } from 'node:path'
import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import * as documents from '../db/repos/documents'
import * as pageText from '../db/repos/pageText'
import { sha256File } from '../files/hash'
import { zDocMeta, zId, zPageText, zPosition } from './schemas'
import type { OpenedDocument, PageTextRow } from '../../shared/types'

const zPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => extname(p).toLowerCase() === '.pdf', 'not a .pdf path')

export function registerDocHandlers(_getWindow: () => BrowserWindow | null): void {
  /** Hash the file, resolve or create its library row, and return it. */
  ipcMain.handle('doc:open', async (_e, rawPath: unknown): Promise<OpenedDocument> => {
    const path = resolvePath(zPath.parse(rawPath))
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)
    const [sha256, info] = await Promise.all([sha256File(path), stat(path)])
    const { doc, isNew } = documents.upsertOnOpen({
      path,
      sha256,
      fileSize: info.size,
      title: basename(path, extname(path))
    })
    // Jump list / recent documents exist only on Windows and macOS.
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.addRecentDocument(path)
    }
    return { doc, isNew }
  })

  /**
   * Bytes are read here rather than fetched over file:// by the renderer, so the
   * renderer keeps webSecurity + sandbox intact and has no filesystem reach.
   * ArrayBuffers cross IPC by structured clone, not JSON.
   */
  ipcMain.handle('doc:readBytes', async (_e, rawId: unknown): Promise<ArrayBuffer> => {
    const doc = documents.getById(zId.parse(rawId))
    if (!doc) throw new Error('Unknown document')
    if (!existsSync(doc.path)) {
      documents.markMissing(doc.id, true)
      throw new Error(`File is no longer at ${doc.path}`)
    }
    const buf = await readFile(doc.path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  ipcMain.handle('doc:updateMeta', (_e, rawId: unknown, rawMeta: unknown) => {
    documents.updateMeta(zId.parse(rawId), zDocMeta.parse(rawMeta))
  })

  ipcMain.handle('doc:savePosition', (_e, rawId: unknown, rawPos: unknown) => {
    documents.savePosition(zId.parse(rawId), zPosition.parse(rawPos))
  })

  ipcMain.handle('doc:getPageText', (_e, rawId: unknown): PageTextRow[] => {
    return pageText.listByDoc(zId.parse(rawId))
  })

  ipcMain.handle('doc:putPageText', (_e, rawId: unknown, rawPages: unknown) => {
    pageText.putMany(zId.parse(rawId), zPageText.parse(rawPages))
  })
}
