import type { NormRect } from '@shared/types'

export interface SearchHit {
  /** Stable id: `${page}:${normStart}` */
  id: string
  page: number
  rects: NormRect[]
  before: string
  hit: string
  after: string
}

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  matchDiacritics: boolean
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  matchDiacritics: false
}
