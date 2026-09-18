---
name: run-pdf-reader
description: Build, launch, drive and screenshot the PDF Reader Electron desktop app. Use when asked to run, start, build, test, debug, screenshot, or interact with the PDF reader — including highlighting, notes, search, outline, zoom, reading modes, or packaging the Windows installer.
---

# Running PDF Reader

An Electron + React + PDF.js desktop app. Highlights and notes are stored in a
SQLite sidecar database; the PDF files themselves are never modified.

**There is no way to click this app by hand from an agent session.** Drive it with
`.claude/skills/run-pdf-reader/driver.mjs`, which speaks the Chrome DevTools
Protocol to a real running instance and dispatches **real OS-level input events**.
That distinction matters here — see Gotchas.

All paths below are relative to the project root (the directory holding
`package.json`). Development happens on **Windows**; there is no xvfb involved.

## Prerequisites

Node 22+ and npm. Nothing else — `better-sqlite3` ships N-API prebuilds, so no
native compilation and no build tools are needed.

```bash
npm install
```

> `npm install` prints an `@electron/rebuild` warning ("Attempting to build a
> module with a space in the path"). **Ignore it.** The prebuilt binary is used
> and works; `npmRebuild: false` is set in `electron-builder.yml` for this reason.

## Build

The driver launches from `out/`, so build before driving:

```bash
npm run build
```

## Run (agent path — use this)

Pipe commands into the driver on stdin:

```bash
node .claude/skills/run-pdf-reader/driver.mjs --out /tmp/pdfout <<'EOF'
launch /path/to/sample.pdf
state
ss opened
quit
EOF
```

Output of exactly that, against the bundled fixture:

```
> launch .../sample.pdf
launched
> state
{
  "view": "reader",
  "docTitle": "sample",
  "page": "1",
  "totalPages": 60,
  "zoom": "125%",
  "mode": "Normal",
  "libraryCards": 0,
  "highlightsDrawn": 0,
  "sidebarItems": 0,
  "highlightsStored": 0
}
> ss opened
screenshot -> /tmp/pdfout/01-opened.png
```

### Commands

| Command | What it does |
| --- | --- |
| `launch [pdf]` | Start the app; a PDF argument opens it via argv (the double-click path) |
| `open <pdf>` | Hand a PDF to the **running** instance (exercises single-instance routing) |
| `state` | Compact dump: view, title, page, zoom, mode, highlight counts |
| `eval <js>` | Run JS in the renderer. Body of an async function — use `return` |
| `click <selector>` | Real mouse click at the element's centre |
| `clicktext <label>` | Real click on the `<button>` whose text is exactly this |
| `drag <selector>` | Real press-drag-release across an element — **this is how you select text** |
| `type <text>` | Real character key events into whatever has focus |
| `key <combo>` | `Escape`, `Enter`, `F3`, `ctrl+f`, … |
| `set <sel> <value>` | Set an input/range value the way React will notice |
| `ss [name]` | Screenshot into the `--out` directory, auto-numbered |
| `sleep <ms>` | Wait |
| `quit` | Stop the app and exit |

Flags: `--out <dir>` (screenshots + throwaway profile), `--port N` (default 9333),
`--reuse-data` (keep the throwaway profile between runs), `--keep-data` (drive the
**real** `%APPDATA%\PDF Reader` library instead of a scratch profile),
`DRIVER_VERBOSE=1` (stream the app's stdout/stderr).

By default the driver uses a throwaway `--user-data-dir`, so driving the app never
touches real annotations — and wipes it on every launch.

**`--reuse-data` and `--keep-data` are not the same thing, and the names invite
the mistake.** To build up a library across several launches — a shelf for a
screenshot, say — use `--reuse-data`, which keeps the *scratch* profile. Reaching
for `--keep-data` to "keep the documents around" instead writes your fixtures,
highlights and reading positions into the user's real library; it prints a
warning line when it does.

### Worked example: highlight, then attach a note

```bash
node .claude/skills/run-pdf-reader/driver.mjs --out /tmp/pdfout <<'EOF'
launch /path/to/sample.pdf
drag .page[data-page="1"] .textLayer span
click .selection-popup .swatch
clicktext Add note
type Driven by the skill driver.
clicktext Save
state
ss highlight-and-note
quit
EOF
```

Ends with `"highlightsDrawn": 1, "sidebarItems": 1, "highlightsStored": 1`.

### Worked example: dark mode and the dim slider

```bash
node .claude/skills/run-pdf-reader/driver.mjs --out /tmp/pdfout <<'EOF'
launch /path/to/sample.pdf
click [data-act="reading-mode"]
clicktext Dark
set input[type=range] 0.7
eval return getComputedStyle(document.querySelector('.page canvas')).filter;
ss dark-dimmed
quit
EOF
```

Prints `"invert(1) hue-rotate(180deg) brightness(0.7)"`.

### Worked example: search and outline

```bash
node .claude/skills/run-pdf-reader/driver.mjs --out /tmp/pdfout <<'EOF'
launch /path/to/sample.pdf
clicktext Outline
eval return [...document.querySelectorAll('.outline-row .label')].slice(0,4).map(e=>e.textContent.trim());
key ctrl+f
type rendering
sleep 2500
eval return { count: document.querySelector('.search-count')?.textContent ?? null, results: document.querySelectorAll('.search-result').length };
quit
EOF
```

Prints `["Section 1","Section 1","Section 2","Section 3"]` then `{"count":"1 / 360","results":360}`.

### Useful selectors

Most toolbar and sidebar buttons carry **no class** — reach them with `clicktext`.

| Thing | Selector |
| --- | --- |
| A page | `.page[data-page="N"]` |
| Text to select | `.page[data-page="1"] .textLayer span` |
| Colour swatch popup | `.selection-popup .swatch` |
| Drawn highlight rects | `.highlight-layer .rect` |
| Sidebar annotation entries | `.ann-item` |
| Note editor | `.ann-item textarea` |
| Library cards | `.lib-card` |
| Outline entries | `.outline-row .label` |
| Search hits / counter | `.search-result` / `.search-count` |
| Page number box | `.page-input` |

The preload API is reachable from `eval` as `window.api` — e.g.
`eval return await window.api.annotations.listByDoc(1);`.

## Fixtures

The repo has no checked-in sample PDF. Generate ones with known content
(60 pages, per-page unique markers like `zebra-001-quartz`, an outline):

```bash
python scripts/make-fixtures.py /tmp/fixtures
```

Needs reportlab. Where pip is unavailable, use the Node fallback — it writes the
same `sample.pdf` (it does not produce `cjk.pdf`, so skip `verify:cjk` there):

```bash
node scripts/make-fixtures.mjs /tmp/fixtures
```

## Existing scenario harnesses

Fixed end-to-end suites, all driving the real app the same way. Run after
`npm run build`:

```bash
npm test                                                      # 36 unit tests (geometry, search normalisation)
node scripts/smoke.mjs <pdf> <out>                            # 29 checks across every feature
node scripts/real-mouse-check.mjs <pdf> <out>                 # real input: highlight + note flow
node scripts/cjk-check.mjs <cjk.pdf> <out>                    # CJK glyphs and cmaps
node scripts/packaged-check.mjs "<app.exe>" <pdf> <out>       # asar, CSP, native module
node scripts/association-check.mjs "<app.exe>" <a.pdf> <b.pdf> # double-click + single instance
```

## Run (human path)

```bash
npm run dev
```

Opens a window with HMR. Useless from an agent session — you cannot click it.

## Package

```bash
npm run build:win        # installer (unsigned) -> dist/
npm run build:linux      # AppImage + .deb — MUST run on Linux, fails on Windows
```

## Gotchas

These cost real debugging time. None are guessable.

- **A leftover instance makes the next launch exit silently with code 0.** The
  single-instance lock is held by any surviving process, and the new one calls
  `app.quit()` — no window, no error, no debug port. The driver calls `taskkill`
  on launch for this reason. If you launch the app some other way and it
  "does nothing", this is why.

- **Synthetic clicks hide real bugs.** `element.click()` dispatches *only* a click
  — no `mousedown`. A shipped bug was invisible to a harness that used it: the
  colour popup lives inside the scroller, whose `mousedown` dismisses the pending
  selection, so a real press destroyed the popup before its click fired. Always
  use `click` / `clicktext` / `drag`, never `eval ...click()`.

- **Text selection cannot be faked with `document.createRange()`.** It bypasses
  hit-testing, z-order and the app's own mouse handlers. `drag` dispatches a real
  press-move-release; nothing else exercises the selection path.

- **pdf.js emits empty spacer spans** between real text runs, so
  `.textLayer span:nth-of-type(3)` frequently selects nothing. `drag` skips
  matches shorter than 10 characters.

- **React ignores `input.value = x`.** It tracks the previous value on the node,
  so a direct assignment never re-renders. Use `set`, which calls the native
  setter before dispatching `input`/`change`.

- **The reading-mode button opens a popover; it does not cycle.** `click
  [data-act="reading-mode"]` opens the panel, then `clicktext Dark` picks the
  mode. Its label follows the mode, so address it by `data-act`, never by text.

- **The dim/dark filter is on the canvas only**, never the page container —
  filtering the container would invert highlights and the selection colour.
  Assert on `getComputedStyle(document.querySelector('.page canvas')).filter`.

- **Pages are virtualised.** `.page` elements exist for the whole document, but
  only visible ones ±1 have a `canvas` and `.textLayer`. Scroll first, then query.

- **`better-sqlite3` 13.0.3 segfaults under the host Node 22** but works fine
  inside Electron (which bundles Node 24). Don't try to unit-test DB code with
  vitest — drive it through the app via `window.api`.

- **Electron 44 bundles Node 24**, not the Node 22 its `engines` field implies.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `app never exposed a debug port` | A stray instance, or you skipped `npm run build`. Run `npm run build`, then retry — the driver kills strays itself. |
| Launch returns instantly, no window | Single-instance lock. `taskkill /F /IM "PDF Reader.exe"` and `taskkill /F /IM electron.exe`. |
| `no button labelled "..."` | Toolbar buttons are icon-only and carry no text. Address them by `data-act` (`library`, `sidebar`, `page-prev`, `page-next`, `zoom-in`, `zoom-out`, `rotate`, `reading-mode`, `import`, `export`) rather than by label. Dump them: `eval return [...document.querySelectorAll('.toolbar button')].map(b=>b.dataset.act);` |
| `drag` selects `""` | The matched span was empty or off-screen. Use `.page[data-page="1"] .textLayer span` and make sure the page is scrolled into view. |
| Blank pages, no glyphs (CJK) | `cmaps`/`standard_fonts`/`wasm` were not copied into the renderer output. Re-run `npm run build`. |
| `mksquashfs ENOENT` on `build:linux` | Linux packaging cannot run on Windows. Build on Linux or in Docker. |
| Screenshot is the library, not a document | `launch` without a PDF argument starts at the library. Pass the path, or `clicktext` a `.lib-card`. |
