import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, resolve as resolvePath } from 'node:path'
import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import * as documents from '../db/repos/documents'
import * as pageText from '../db/repos/pageText'
import * as thumbnails from '../db/repos/thumbnails'
import { sha256File } from '../files/hash'
import { loadDocImage } from '../files/images'
import { kindFromPath } from '../files/kind'
import {
  zDocMeta,
  zDocPath,
  zId,
  zImageSrc,
  zPageText,
  zPosition,
  zThumbnail
} from './schemas'
import type {
  DocImage,
  DocumentRow,
  OpenedDocument,
  PageTextRow,
  ThumbnailRow
} from '../../shared/types'

/** Far beyond any hand-written document; stops a mislabelled binary from being
 *  decoded and shipped across IPC as one enormous string. */
const MAX_TEXT_BYTES = 20 * 1024 * 1024

function existingDoc(rawId: unknown): DocumentRow {
  const doc = documents.getById(zId.parse(rawId))
  if (!doc) throw new Error('Unknown document')
  if (!existsSync(doc.path)) {
    documents.markMissing(doc.id, true)
    throw new Error(`File is no longer at ${doc.path}`)
  }
  return doc
}

export function registerDocHandlers(_getWindow: () => BrowserWindow | null): void {
  /** Hash the file, resolve or create its library row, and return it. */
  ipcMain.handle('doc:open', async (_e, rawPath: unknown): Promise<OpenedDocument> => {
    const path = resolvePath(zDocPath.parse(rawPath))
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)
    const [sha256, info] = await Promise.all([sha256File(path), stat(path)])
    const { doc, isNew } = documents.upsertOnOpen({
      path,
      sha256,
      kind: kindFromPath(path)!,
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
    const doc = existingDoc(rawId)
    const buf = await readFile(doc.path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })

  /** Markdown is decoded here so the renderer never sees bytes it might misread. */
  ipcMain.handle('doc:readText', async (_e, rawId: unknown): Promise<string> => {
    const doc = existingDoc(rawId)
    if (doc.kind !== 'markdown') throw new Error('Not a Markdown document')
    const info = await stat(doc.path)
    if (info.size > MAX_TEXT_BYTES) throw new Error('This file is too large to display')
    return (await readFile(doc.path, 'utf8')).replace(/^\uFEFF/, '')
  })

  ipcMain.handle(
    'doc:readImage',
    async (_e, rawId: unknown, rawSrc: unknown): Promise<DocImage | null> => {
      const doc = documents.getById(zId.parse(rawId))
      if (!doc || doc.kind !== 'markdown') return null
      return loadDocImage(doc.path, zImageSrc.parse(rawSrc))
    }
  )

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

  ipcMain.handle('doc:getThumbnail', (_e, rawId: unknown): ThumbnailRow | null => {
    return thumbnails.get(zId.parse(rawId))
  })

  ipcMain.handle('doc:putThumbnail', (_e, rawId: unknown, rawThumb: unknown) => {
    thumbnails.put(zId.parse(rawId), zThumbnail.parse(rawThumb))
  })
}
