import { Marked } from 'marked'

/** Schemes a Markdown link may carry out of the app; main re-checks every one. */
const EXTERNAL_LINK = /^(https?:|mailto:)/i

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** GitHub's heading anchors, so links written for a README land in the same place. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/**
 * Markdown to HTML that is safe to put in the DOM as-is.
 *
 * Nothing here relies on a sanitiser: raw HTML in the source is escaped and shown
 * as text, links survive only with an allowed scheme, and images are emitted
 * without a `src` — MarkdownView asks main for the bytes, so the document cannot
 * make the renderer load anything itself.
 */
export function renderMarkdown(source: string): string {
  // Per render, so the same heading text in two documents gets the same anchor.
  const seen = new Map<string, number>()
  const anchorFor = (text: string): string => {
    const base = slugify(text) || 'section'
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n}`
  }

  const marked = new Marked({
    gfm: true,
    renderer: {
      html({ text, block }) {
        return block ? `<p class="md-raw">${escapeHtml(text)}</p>\n` : escapeHtml(text)
      },
      heading({ tokens, depth }) {
        const plain = this.parser.parseInline(tokens, this.parser.textRenderer)
        const body = this.parser.parseInline(tokens)
        return `<h${depth} id="${escapeHtml(anchorFor(plain))}">${body}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const body = this.parser.parseInline(tokens)
        if (!href.startsWith('#') && !EXTERNAL_LINK.test(href)) return body
        const t = title ? ` title="${escapeHtml(title)}"` : ''
        return `<a href="${escapeHtml(href)}"${t}>${body}</a>`
      },
      image({ href, title, text }) {
        const t = title ? ` title="${escapeHtml(title)}"` : ''
        return `<img data-md-src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}>`
      }
    }
  })

  return marked.parse(source, { async: false })
}
