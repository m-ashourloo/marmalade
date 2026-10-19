import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Icon } from '../ui/Icon'
import { resolveDestination } from './destinations'

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
    // An unresolvable destination just becomes a non-navigable row.
    const resolved = await resolveDestination(pdf, item.dest)
    const children = await Promise.all((item.items ?? []).map(resolveNode))
    return {
      title: item.title ?? '',
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      children,
      page: resolved?.page ?? null,
      yFraction: resolved?.yFraction ?? null,
      url: item.url ?? null
    }
  }

  return Promise.all(raw.map(resolveNode))
}

type RowActions = {
  onNavigate: (page: number, yFraction: number) => void
  /** Bookmarks can point at a web address instead of a page. */
  onOpenUrl: (url: string) => void
}

export function OutlinePanel({
  pdf,
  onNavigate,
  onOpenUrl
}: { pdf: PDFDocumentProxy } & RowActions): React.JSX.Element {
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
        <OutlineRow key={i} node={n} depth={0} onNavigate={onNavigate} onOpenUrl={onOpenUrl} />
      ))}
    </>
  )
}

function OutlineRow({
  node,
  depth,
  onNavigate,
  onOpenUrl
}: { node: OutlineNode; depth: number } & RowActions): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  return (
    <div className="outline-node">
      <div
        className="outline-row"
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          if (node.page !== null) onNavigate(node.page, node.yFraction ?? 0)
          else if (node.url) onOpenUrl(node.url)
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
            opacity: node.page === null && !node.url ? 0.5 : 1
          }}
          title={
            node.page !== null ? `Page ${node.page}` : (node.url ?? 'Destination unavailable')
          }
        >
          {node.title}
        </span>
      </div>
      {open &&
        node.children.map((c, i) => (
          <OutlineRow
            key={i}
            node={c}
            depth={depth + 1}
            onNavigate={onNavigate}
            onOpenUrl={onOpenUrl}
          />
        ))}
    </div>
  )
}
