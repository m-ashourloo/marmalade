import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Icon } from '../ui/Icon'

export interface OutlineNode {
  title: string
  bold: boolean
  italic: boolean
  children: OutlineNode[]
  /** Resolved 1-based page, or null when the destination could not be resolved. */
  page: number | null
  /** Vertical position within the page, 0 (top) to 1 (bottom), if the dest gives one. */
  yFraction: number | null
  url: string | null
}

type RawOutline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>

/** Resolve pdf.js outline entries to page numbers and scroll offsets. */
export async function buildOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await pdf.getOutline().catch(() => null)
  if (!raw) return []

  const resolveNode = async (item: RawOutline[number]): Promise<OutlineNode> => {
    let page: number | null = null
    let yFraction: number | null = null

    try {
      // getDestination() still returns an array (unlike getDestinations(), which
      // became a Map in pdf.js 6).
      const explicit =
        typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest

      if (Array.isArray(explicit) && explicit.length > 0) {
        const ref = explicit[0]
        const pageIndex =
          typeof ref === 'number' ? ref : await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
        page = pageIndex + 1

        // An XYZ / FitH destination carries a `top` in PDF user space.
        const kind = (explicit[1] as { name?: string } | undefined)?.name
        const top = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null
        if (typeof top === 'number') {
          const pageProxy = await pdf.getPage(page)
          const view = pageProxy.view
          const height = view[3] - view[1]
          if (height > 0) yFraction = clamp01((view[3] - top) / height)
        }
      }
    } catch {
      /* an unresolvable destination just becomes a non-navigable row */
    }

    const children = await Promise.all((item.items ?? []).map(resolveNode))
    return {
      title: item.title ?? '',
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      children,
      page,
      yFraction,
      url: item.url ?? null
    }
  }

  return Promise.all(raw.map(resolveNode))
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function OutlinePanel({
  pdf,
  onNavigate
}: {
  pdf: PDFDocumentProxy
  onNavigate: (page: number, yFraction: number) => void
}): React.JSX.Element {
  const [nodes, setNodes] = useState<OutlineNode[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void buildOutline(pdf).then((n) => {
      if (!cancelled) setNodes(n)
    })
    return () => {
      cancelled = true
    }
  }, [pdf])

  if (nodes === null) return <div className="sidebar-empty">Reading outline…</div>
  if (nodes.length === 0) {
    return <div className="sidebar-empty">This document has no bookmarks.</div>
  }

  return (
    <>
      {nodes.map((n, i) => (
        <OutlineRow key={i} node={n} depth={0} onNavigate={onNavigate} />
      ))}
    </>
  )
}

function OutlineRow({
  node,
  depth,
  onNavigate
}: {
  node: OutlineNode
  depth: number
  onNavigate: (page: number, yFraction: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  return (
    <div className="outline-node">
      <div
        className="outline-row"
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          if (node.page !== null) onNavigate(node.page, node.yFraction ?? 0)
        }}
      >
        <span
          className="twisty"
          data-open={hasChildren && open}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setOpen((v) => !v)
          }}
        >
          {hasChildren && <Icon name="forward" size={12} />}
        </span>
        <span
          className="label"
          style={{
            fontWeight: node.bold ? 600 : 400,
            fontStyle: node.italic ? 'italic' : undefined,
            opacity: node.page === null ? 0.5 : 1
          }}
          title={node.page !== null ? `Page ${node.page}` : 'Destination unavailable'}
        >
          {node.title}
        </span>
      </div>
      {open &&
        node.children.map((c, i) => (
          <OutlineRow key={i} node={c} depth={depth + 1} onNavigate={onNavigate} />
        ))}
    </div>
  )
}
