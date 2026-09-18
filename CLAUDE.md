# CLAUDE.md

Electron + React + PDF.js desktop PDF reader with highlighting, notes, search,
outline navigation and dimmed reading modes. Windows is the primary target;
Linux is configured but unverified.

## Running and verifying your changes

**Use the `run-pdf-reader` skill** (`.claude/skills/run-pdf-reader/`). It has the
driver, worked examples and the trap list. Short version:

```bash
npm run build
node .claude/skills/run-pdf-reader/driver.mjs --out /tmp/out <<'EOF'
launch /path/to/sample.pdf
state
ss check
quit
EOF
```

Generate test PDFs with `python scripts/make-fixtures.py <dir>`, or
`node scripts/make-fixtures.mjs <dir>` where reportlab cannot be installed —
the Node version emits the same sample.pdf the harnesses assert against.

Before claiming a UI change works, drive it and **look at the screenshot**. The
unit tests cover geometry and search normalisation only — they cannot tell you
whether a button is clickable.

```bash
npm test                                       # 36 unit tests
node scripts/smoke.mjs <pdf> <out>             # 29 end-to-end checks
node scripts/real-mouse-check.mjs <pdf> <out>  # real input: highlight + note
npm run typecheck
```

## Architecture boundary

```
main (Node)                preload (sandboxed)      renderer (React)
better-sqlite3, fs,   ←IPC→ contextBridge `api` ←→  PDF.js viewer + UI
SHA-256, dialogs, argv      (narrow, typed)         pdf.worker
```

- **All** filesystem and database work happens in main. The renderer runs with
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- PDF bytes cross IPC as an `ArrayBuffer`; the renderer never touches `file://`.
- The preload exposes **verb-shaped** methods (`api.doc.readBytes(id)`). Never add
  a generic `invoke(channel, ...)` passthrough — it re-exposes every handler.
- Every IPC payload is validated with zod in the main handler before reaching
  disk or SQL (`src/main/ipc/schemas.ts`). New handler ⇒ new schema.
- `src/shared/` is **type-only**. A `node:` import there breaks the sandboxed
  renderer build.

## Invariants — do not break these

- **PDF files are never modified.** Annotations live in a sidecar SQLite DB. If a
  change would write to the user's PDF, it is wrong.
- **Document identity is the SHA-256, not the path.** This is what keeps
  annotations attached when a file is moved or renamed.
- **Highlight colours are stored as semantic keys** (`yellow`, `green`…), never
  hex — dark mode remaps them at render time, and `multiply` over an inverted
  page yields black.
- **Highlight geometry is stored normalised 0–1** against the page crop box and
  re-laid out from that on every zoom. Never CSS-transform-scale it.
- **The dim/dark filter applies to `.page canvas` only**, never the page
  container — filtering the container inverts the highlight overlay and the
  selection colour too.
- **Zoom and rotation re-anchor the scroll position** from a page + fraction,
  because `scrollTop` is in pixels and would otherwise drift to another page.

## Traps

- **Synthetic clicks hide real bugs.** `element.click()` fires no `mousedown`. A
  shipped bug was invisible to a harness using it. Drive input through the driver.
- **`better-sqlite3` 13 segfaults on the host Node 22** but is fine inside
  Electron (Node 24). Don't unit-test DB code; exercise it through `window.api`.
- **A leftover app instance holds the single-instance lock**, so the next launch
  exits silently with code 0.
- **Pages are virtualised** — only visible pages ±1 have a canvas and text layer.
- **`pdfjs-dist/web/pdf_viewer.css` is mandatory** and `--total-scale-factor`
  must be set, or selection rectangles silently drift from the glyphs.
- Full list with reproductions: `.claude/skills/run-pdf-reader/SKILL.md` and the
  Gotchas section of `README.md`.

## Conventions

- TypeScript strict; no `any` in new code. Path aliases `@shared/*`, `@renderer/*`.
- Comments explain **why**, not what. Match the surrounding density — this
  codebase comments non-obvious decisions and leaves mechanics unannotated.
- Prefer extending an existing harness in `scripts/` over writing a new one.
- Don't add dependencies without a reason the existing stack can't cover.
