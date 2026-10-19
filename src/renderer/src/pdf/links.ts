import type { NormRect } from '@shared/types'
import type { PdfDest } from './destinations'
import { pdfRectToNorm, type PageBox } from './geometry'

const NAMED_ACTIONS = ['NextPage', 'PrevPage', 'FirstPage', 'LastPage', 'GoBack', 'GoForward'] as const
export type NamedAction = (typeof NAMED_ACTIONS)[number]

export type LinkTarget =
  | { kind: 'external'; url: string }
  | { kind: 'dest'; dest: PdfDest }
  | { kind: 'named'; action: NamedAction }

export interface PageLink {
  rect: NormRect
  target: LinkTarget
}

/** The fields of a pdf.js annotation this module reads; getAnnotations() is untyped. */
interface RawAnnotation {
  subtype?: string
  rect?: number[]
  url?: string
  dest?: PdfDest
  action?: string
}

/**
 * Keep the link annotations we can act on. Launch, GoToR, JavaScript and
 * attachment links are dropped on purpose: each would let a document reach
 * outside the viewer.
 */
export function extractLinks(annotations: unknown[], box: PageBox): PageLink[] {
  const links: PageLink[] = []
  for (const a of annotations as RawAnnotation[]) {
    if (a.subtype !== 'Link' || !Array.isArray(a.rect) || a.rect.length !== 4) continue

    let target: LinkTarget | null = null
    // pdf.js fills `url` only once it has validated the URI, unlike `unsafeUrl`.
    if (a.url) target = { kind: 'external', url: a.url }
    else if (a.dest) target = { kind: 'dest', dest: a.dest }
    else if (NAMED_ACTIONS.includes(a.action as NamedAction)) {
      target = { kind: 'named', action: a.action as NamedAction }
    }
    if (!target) continue

    const rect = pdfRectToNorm(a.rect, box)
    if (rect.x1 - rect.x0 < 1e-6 || rect.y1 - rect.y0 < 1e-6) continue
    links.push({ rect, target })
  }
  return links
}
