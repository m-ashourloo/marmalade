import { extname } from 'node:path'
import type { DocumentKind } from '../../shared/types'

const KIND_BY_EXT: Record<string, DocumentKind> = {
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown'
}

/** The format is decided by extension, once, when the file is first opened. */
export function kindFromPath(path: string): DocumentKind | null {
  return KIND_BY_EXT[extname(path).toLowerCase()] ?? null
}

export const OPENABLE_EXTENSIONS = Object.keys(KIND_BY_EXT).map((e) => e.slice(1))
