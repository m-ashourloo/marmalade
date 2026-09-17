# Marmalade

A Windows desktop PDF reader for reading, highlighting and annotating — built with
Electron, React and Mozilla PDF.js.

**Your PDF files are never modified.** Highlights and notes live in a local SQLite
database keyed by the file's SHA-256, so annotations follow a document even when it
is renamed or moved.

## Features

- Continuous-scroll reading with zoom (50–400%), rotation and page navigation
- Text selection → multi-colour highlights, with one note per highlight
- Annotation sidebar listing every highlight with its quoted text and note
- Library of recently opened documents, resuming at the exact page and scroll offset
- Full-text search within a document, including phrases split across PDF text runs
- PDF bookmark/outline navigation
- Export and import highlights and notes as a portable `.mmnotes.json` file —
  drop one on the import dialog and it finds its PDF by hash
- **Eye-protection reading modes** — Normal, Sepia and Dark (inverted), plus
  independent brightness and warmth sliders

## Getting started

```bash
npm install
npm run dev
```

## Installing

Run `dist/Marmalade-1.0.0-setup.exe`. It installs machine-wide, so Windows asks
for administrator approval — that is required for the `.pdf` file association to
register.

The installer adds Start Menu and desktop shortcuts and registers Marmalade as an
*Open with* handler for `.pdf`. It deliberately does **not** seize your default
PDF application; to make it the default use *Settings → Apps → Default apps*, or
right-click a PDF → *Open with* → *Choose another app*.

Highlights and notes live in `%APPDATA%\Marmalade\library.db`. Uninstalling
leaves that file in place, so reinstalling keeps every annotation.

## Platform support

The stack — Electron, React and PDF.js — is cross-platform, and `better-sqlite3`
ships N-API prebuilds for `linux-x64`, `linux-arm64`, `linuxmusl-*`, `darwin-*`
and `win32-*`, so no native compilation is needed on any of them.

| Platform | Status |
| --- | --- |
| Windows x64 | Built, installed and verified end to end |
| Linux (Ubuntu/Debian) | Configured, **not yet run** — see below |
| macOS | Configured; would need an Apple Developer ID to notarise |

### Building for Ubuntu

**Linux packages must be built on Linux.** electron-builder needs `mksquashfs` and
related tooling for AppImage and `.deb`, which do not exist on Windows — the app
itself cross-packs fine, but the packaging step fails. On any Ubuntu machine:

```bash
git clone <this repo> && cd "PDF Reader"
npm install
npm run build:linux
```

That produces an `.AppImage` (runs on any distribution, no install) and a `.deb`
(`sudo apt install ./marmalade_1.0.0_amd64.deb`) in `dist/`. Docker is the other
option if you would rather not leave Windows:

```bash
docker run --rm -v "${PWD}:/project" electronuserland/builder:latest \
  bash -c "cd /project && npm install && npm run build:linux"
```

The Linux build registers the app as a PDF handler via the desktop entry's
`MimeType`, which is the equivalent of the Windows file association. Annotations
live in `~/.config/Marmalade/library.db`.

Nothing in the source is Windows-only: the two platform-specific calls
(`app.addRecentDocument`, which exists only on Windows and macOS, and the
`darwin` check in `window-all-closed`) are guarded, and the UI font stack falls
through to Ubuntu/Cantarell/Noto Sans. That said, **the Linux build has not been
run**, so treat the first launch there as untested.

## Building a release

```bash
npm run build:win      # Windows installer (unsigned)
npm run build:linux    # AppImage + .deb (must run on Linux)
npm run build:mac      # .dmg (must run on macOS)
```

All write to `dist/`. `npm run icons` regenerates the icon set from
`scripts/make-icons.py`.

### Unsigned binaries

Releases are **not code-signed**, so Windows SmartScreen shows *"Windows protected
your PC"* on first run — click **More info → Run anyway**. electron-builder honours
`CSC_LINK` / `CSC_KEY_PASSWORD` if you want to sign your own builds; nothing in the
repo needs to change.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open a PDF |
| `Ctrl+F` | Find in document |
| `F3` / `Shift+F3` | Next / previous match |
| `Ctrl` `+` / `-` / `0` | Zoom in / out / reset |
| `Ctrl+Enter` | Save the note being edited |

## Architecture

```
main process (Node)            preload (sandboxed)      renderer (React)
─────────────────────          ───────────────────      ────────────────────────
better-sqlite3 database  ←IPC→  contextBridge `api`  ←→  PDF.js viewer + UI
file reads, SHA-256              (narrow, typed)         pdf.worker (module worker)
dialogs, argv, window
```

All filesystem and database work happens in the main process. The renderer runs
with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and
receives PDF bytes as an `ArrayBuffer` over IPC rather than reading `file://` URLs
directly. Every IPC payload is validated with zod in the main-process handler
before it reaches disk or SQL. A strict CSP is applied in packaged builds.

### Source layout

| Path | Contents |
| --- | --- |
| `src/main/` | App lifecycle, window, IPC handlers, database repositories |
| `src/preload/` | The `window.api` contextBridge surface |
| `src/shared/` | Types shared across all three processes (type-only) |
| `src/renderer/src/pdf/` | Viewer, page rendering, geometry, selection capture |
| `src/renderer/src/search/` | Text index, normalisation, match geometry |
| `src/renderer/src/annotations/` | Highlight state and the notes sidebar |
| `src/renderer/src/theme/` | Reading modes and colour resolution |
| `src/renderer/src/transfer/` | The import dialog |
| `src/main/transfer/` | The `.mmnotes.json` format: build, validate, merge key |

### How highlights are stored

A DOM selection over the PDF.js text layer yields one rectangle per visual line.
Each rectangle is converted into PDF user space via `viewport.convertToPdfPoint`
(never by dividing by the zoom, since the viewport also encodes rotation), then
normalised to 0–1 against the page's crop box. Rendering back inverts that, so a
highlight captured at 100% lands exactly right at 400% and under rotation.

Highlight colours are stored as *semantic keys* (`yellow`, `green`, …), not hex.
That is what lets dark mode remap them: over a normal page the overlay blends with
`multiply`, but over an inverted page `multiply` would render black, so dark mode
switches to `screen` with darker fills.

### Exporting and importing annotations

An export is a versioned JSON bundle holding the document's SHA-256 and every
highlight with its normalised rects, semantic colour key, quoted text and note.
Because geometry is stored 0–1 and colours are keys, a bundle is portable across
machines, zoom levels and reading modes.

Import resolves the target PDF by that SHA-256, so a file that has been moved or
renamed still matches. If the hash is unknown the dialog offers to attach the
annotations to the document you currently have open, with a warning. Merging
never deletes: an incoming highlight whose page, colour and geometry already
exist is counted and skipped, which makes importing the same file twice a no-op.

Both halves of the feature are split into a dialog-free IPC call and a dialog
one (`transfer:buildExport` / `transfer:saveExport`), because a native modal
dialog blocks the CDP driver and would otherwise make the format untestable.

### Reading modes

The mode filter is applied to the page `<canvas>` and nothing else. Filtering the
page container instead would invert the highlight overlay and the text selection
colour along with the page.

## Agent tooling

`.claude/skills/run-pdf-reader/` holds a skill that builds, launches and drives
the app over the DevTools Protocol with real mouse and keyboard events, plus the
full trap list. `CLAUDE.md` carries the architectural invariants. Test PDFs come
from `python scripts/make-fixtures.py <dir>`.

## Tests

```bash
npm test               # unit tests (geometry round-trips, search normalisation)
npm run typecheck      # both TypeScript projects
```

The geometry tests run against a real PDF.js `PageViewport` obtained from a
minimal in-memory PDF, rather than a hand-written stub that could encode the same
transform bug the tests exist to catch.

### End-to-end verification

Four harnesses drive the real application over the Chrome DevTools Protocol —
there is no test-only code inside the app.

```bash
npm run build
npm run verify:smoke     -- <sample.pdf> <out-dir>   # 28 checks + screenshots
npm run verify:mouse     -- <sample.pdf> <out-dir>   # real mouse/keyboard input
npm run verify:cjk       -- <cjk.pdf>    <out-dir>   # CJK glyphs and cmaps
npm run verify:packaged  -- "dist/win-unpacked/Marmalade.exe" <pdf> <out-dir>
npm run verify:assoc     -- "C:/Program Files/Marmalade/Marmalade.exe" <a.pdf> <b.pdf>
```

`verify:assoc` runs against an **installed** copy and covers the double-click
path: opening a PDF passed on the command line, and a second launch handing its
file to the already-running window instead of starting a duplicate.

`verify:mouse` exists because the smoke test drives the UI through synthetic DOM
events, which bypass the browser's own input handling. It dispatches genuine
press-drag-release and key events instead, and it is the only harness that can
catch an interaction which is broken for a real user but fine for a script — the
swatch-dismissal bug below was exactly that.

The smoke test covers page virtualisation, text-layer alignment, highlight
creation from a real DOM selection, note persistence, zoom-invariant highlight
geometry, search (including a phrase spanning several PDF text runs), outline
navigation, zoom anchoring, every reading mode, and survival across a restart. The packaged check
additionally verifies that `better-sqlite3` loads from `app.asar.unpacked` and
that the strict CSP does not block the PDF.js worker.

## Notable implementation constraints

- **pdf.js 6 removed `convertToViewportRectangle`.** Rectangles are converted by
  transforming both corners with `convertToViewportPoint`.
- **`PDFDocumentProxy.destroy()` was removed in pdf.js 6.** Teardown goes through
  `loadingTask.destroy()`.
- **`pdfjs-dist/web/pdf_viewer.css` must be imported.** The `TextLayer` class
  writes CSS custom properties but no `font-size`/`transform`; without those rules
  selection rectangles silently drift away from the glyphs.
- **`backgroundThrottling: false` is load-bearing.** pdf.js drives its own
  rasterisation loop with `requestAnimationFrame`, and Chromium stops rAF
  entirely for occluded windows. Without this setting, a page that starts
  rendering as the user switches away never finishes — the render promise simply
  never settles — and the viewer is frozen when they switch back. For the same
  reason the viewer's own scroll handling does not go through rAF.
- **Canvas memory is the main crash risk.** Only visible pages ±1 are rasterised,
  device pixel ratio is capped at 2, and canvases are zeroed on unmount.
- **`better-sqlite3` 13 ships N-API prebuilds** that load unchanged under Electron
  44, so no native rebuild step is needed — which matters here because `node-gyp`
  cannot build from a path containing a space. `npmRebuild` is therefore off.
  Note that the same prebuild segfaults under Node 22 on the host; it is only
  loaded inside Electron (which bundles Node 24).
- **A file association's `name` becomes the registry ProgID**, so it must be
  unique to this app (`Marmalade.Document.pdf`). A generic value such as
  "PDF Document" would collide with every other PDF reader on the machine.
- **`productName` in `package.json` decides the user-data folder name.** It was
  added at 1.0.0 so annotations live in `%APPDATA%\Marmalade`; `src/main/index.ts`
  migrates a pre-1.0 `%APPDATA%\pdf-reader` or 1.0.0 `%APPDATA%\PDF Reader`
  library across on first run.
- A leftover instance holds the single-instance lock, so a crashed or force-killed
  copy makes the next launch exit silently until it is gone.
- The partial unique index on `notes(highlight_id)` requires its `WHERE` clause to
  be repeated in the `ON CONFLICT` target, or SQLite rejects the upsert.
- **Zoom and rotation re-anchor the scroll position.** `scrollTop` is in pixels,
  so rescaling the layout underneath it slides the reader to a different page. The
  viewer records where it is as a page plus a fraction within that page, and
  restores from that in a layout effect (before paint, so there is no flicker).
- **The selection popup must stop `mousedown` propagation.** It is rendered inside
  the scroller, whose `mousedown` handler dismisses a pending selection — so a real
  press on a colour swatch unmounted the popup before its `click` could fire, and
  nothing happened. A synthetic `.click()` dispatches no `mousedown` and so never
  reproduced it.

## Known limitations

- Search-hit rectangles are derived geometrically from each text run's transform
  and advance width, interpolating by character fraction. For proportional fonts
  this can be off by up to about a character at the edges of a match. Highlights
  created from a real selection are exact; only search hits use the approximation.
- Annotations are not written into the PDF, so other readers will not see them.
  Exporting notes to Markdown, and exporting an annotated copy of the PDF, are not
  implemented.

## Licence

MIT — see [LICENSE](LICENSE).
