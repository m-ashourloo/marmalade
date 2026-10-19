import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { net } from 'electron'
import type { DocImage } from '../../shared/types'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const REMOTE_TIMEOUT_MS = 10_000

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

/**
 * Resolves an image reference from a Markdown document to bytes, or null when it
 * cannot or should not be shown. Only image extensions are read from disk, so a
 * document cannot use an <img> to pull arbitrary local files into the window.
 */
export async function loadDocImage(docPath: string, src: string): Promise<DocImage | null> {
  try {
    // A drive-letter path parses as a URL with a one-letter scheme.
    if (/^[a-z]:[\\/]/i.test(src)) return await loadLocal(src)
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      const url = new URL(src)
      if (url.protocol === 'file:') return await loadLocal(fileURLToPath(url))
      if (url.protocol === 'http:' || url.protocol === 'https:') return await loadRemote(url)
      return null
    }
    // Markdown writers percent-encode spaces; a query or fragment means nothing on disk.
    const rel = safeDecode(src.replace(/[?#].*$/, ''))
    return await loadLocal(isAbsolute(rel) ? rel : resolvePath(dirname(docPath), rel))
  } catch {
    return null
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

async function loadLocal(path: string): Promise<DocImage | null> {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()]
  if (!mime) return null
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null
  const buf = await readFile(path)
  return { mime, bytes: toArrayBuffer(buf) }
}

async function loadRemote(url: URL): Promise<DocImage | null> {
  const res = await net.fetch(url.href, {
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    credentials: 'omit'
  })
  if (!res.ok || !res.body) return null
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/')) return null
  const declared = Number(res.headers.get('content-length'))
  if (declared > MAX_IMAGE_BYTES) return null

  // content-length can be absent or wrong, so the cap is enforced while reading.
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return { mime, bytes: toArrayBuffer(Buffer.concat(chunks)) }
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
