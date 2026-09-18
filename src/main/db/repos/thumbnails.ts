import { getDb } from '../connection'

/** A cached render of the page the reader last stopped on, shown on the library
 *  screen. Regenerated whenever a document is closed, so it stays current. */
export interface StoredThumbnail {
  page: number
  width: number
  height: number
  image: ArrayBuffer
}

export function get(docId: number): StoredThumbnail | null {
  const r = getDb()
    .prepare('SELECT page, width, height, image FROM thumbnails WHERE doc_id = ?')
    .get(docId) as { page: number; width: number; height: number; image: Buffer } | undefined
  if (!r) return null
  // better-sqlite3 hands BLOBs back as a Buffer view into a shared pool; returning
  // r.image.buffer directly would ship the entire pool across IPC.
  return {
    page: r.page,
    width: r.width,
    height: r.height,
    image: r.image.buffer.slice(
      r.image.byteOffset,
      r.image.byteOffset + r.image.byteLength
    ) as ArrayBuffer
  }
}

export function put(
  docId: number,
  thumb: { page: number; width: number; height: number; image: Uint8Array }
): void {
  getDb()
    .prepare(
      `INSERT INTO thumbnails (doc_id, page, width, height, image, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(doc_id) DO UPDATE SET
         page = excluded.page, width = excluded.width, height = excluded.height,
         image = excluded.image, updated_at = excluded.updated_at`
    )
    .run(docId, thumb.page, thumb.width, thumb.height, thumb.image, Date.now())
}
