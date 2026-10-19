import { describe, expect, it } from 'vitest'
import { renderMarkdown, slugify } from './render'

describe('renderMarkdown', () => {
  it('shows raw HTML as text instead of injecting it', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(2)">')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img src/i)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('onerror=&quot;alert(2)&quot;')
  })

  it('keeps http, https, mailto and fragment links', () => {
    const html = renderMarkdown(
      '[a](https://example.com) [b](http://x.test) [c](mailto:me@x.test) [d](#intro)'
    )
    expect(html).toContain('<a href="https://example.com">a</a>')
    expect(html).toContain('<a href="http://x.test">b</a>')
    expect(html).toContain('<a href="mailto:me@x.test">c</a>')
    expect(html).toContain('<a href="#intro">d</a>')
  })

  it('drops the href from any other scheme or a relative file', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) [y](file:///etc/passwd) [z](other.md)')
    expect(html).not.toContain('<a')
    expect(html).toContain('x')
    expect(html).toContain('z')
  })

  it('emits images without a src, so nothing loads until main resolves them', () => {
    const html = renderMarkdown('![A "dot"](img/dot.png "Dot")')
    expect(html).toContain('data-md-src="img/dot.png"')
    expect(html).toContain('alt="A &quot;dot&quot;"')
    expect(html).not.toMatch(/\ssrc=/)
  })

  it('anchors headings the way GitHub does, numbering repeats', () => {
    const html = renderMarkdown('# Getting started!\n\n## Notes\n\n## Notes')
    expect(html).toContain('<h1 id="getting-started">')
    expect(html).toContain('<h2 id="notes">')
    expect(html).toContain('<h2 id="notes-1">')
  })

  it('starts anchor numbering afresh for each document', () => {
    renderMarkdown('# Notes')
    expect(renderMarkdown('# Notes')).toContain('<h1 id="notes">')
  })

  it('renders GFM tables and task lists', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>2</td>')
    expect(html).toMatch(/<input checked="" disabled="" type="checkbox">/)
  })
})

describe('slugify', () => {
  it('keeps letters from other scripts', () => {
    expect(slugify('Café Überblick')).toBe('café-überblick')
    expect(slugify('مقدمه کتاب')).toBe('مقدمه-کتاب')
  })
})
