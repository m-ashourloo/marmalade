/**
 * End-to-end smoke test: launches the real built app, drives the real renderer
 * over the Chrome DevTools Protocol, and writes screenshots.
 *
 * Usage: node scripts/smoke.mjs <path-to-pdf> <out-dir>
 *
 * Deliberately uses CDP rather than any test hook inside the app, so what is
 * exercised is exactly what ships.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electronPath from 'electron'

const PDF = resolve(process.argv[2])
const OUT = resolve(process.argv[3] ?? 'smoke-out')
const PORT = 9223

const log = (...a) => console.log('[smoke]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('renderer target never appeared')
}

class Cdp {
  #ws
  #id = 0
  #pending = new Map()

  static async connect(url) {
    const c = new Cdp()
    c.#ws = new WebSocket(url)
    await new Promise((res, rej) => {
      c.#ws.onopen = res
      c.#ws.onerror = rej
    })
    c.#ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      const p = c.#pending.get(msg.id)
      if (!p) return
      c.#pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    }
    return c
  }

  send(method, params = {}, timeout = 60000) {
    const id = ++this.#id
    this.#ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`${method} timed out`)), timeout)
    })
  }

  /** Evaluate an async expression in the page and return its value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)
      )
    }
    return r.result.value
  }

  async screenshot(file) {
    try {
      const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, 15000)
      await writeFile(file, Buffer.from(data, 'base64'))
      log('screenshot →', file)
    } catch (e) {
      log('screenshot FAILED', file, e.message)
    }
  }

  close() {
    this.#ws.close()
  }
}

/** Poll `expr` (an async body returning a value) until `ok(value)` or timeout. */
async function waitFor(cdp, expr, ok, { timeout = 20000, interval = 250, label = '' } = {}) {
  const deadline = Date.now() + timeout
  let last
  for (;;) {
    last = await cdp.eval(expr)
    if (ok(last)) return last
    if (Date.now() > deadline) {
      log(`waitFor(${label}) timed out; last =`, JSON.stringify(last))
      return last
    }
    await sleep(interval)
  }
}

const failures = []
function check(name, condition, detail = '') {
  if (condition) log(`PASS  ${name}`)
  else {
    log(`FAIL  ${name} ${detail}`)
    failures.push(`${name} ${detail}`)
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })

  // A throwaway profile, so each run starts from an empty library database.
  const userData = resolve(OUT, 'userdata')
  await rm(userData, { recursive: true, force: true })

  const child = spawn(
    electronPath,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    {
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const rendererLogs = []
  child.stdout.on('data', (d) => rendererLogs.push(String(d)))
  child.stderr.on('data', (d) => rendererLogs.push(String(d)))

  let cdp
  try {
    const target = await waitForTarget()
    cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await sleep(1500)

    // ---- library screen -------------------------------------------------
    const hasApi = await cdp.eval('return typeof window.api === "object"')
    check('preload bridge exposed', hasApi === true)

    await cdp.screenshot(`${OUT}/01-library.png`)

    // ---- open the document ----------------------------------------------
    const opened = await cdp.eval(`
      const r = await window.api.doc.open(${JSON.stringify(PDF)});
      return { id: r.doc.id, isNew: r.isNew, sha: r.doc.sha256.slice(0, 12) };
    `)
    log('opened doc', JSON.stringify(opened))
    check('doc:open returns a row', typeof opened?.id === 'number')

    // The library list was fetched when the app mounted, before the document
    // existed — reload so the start screen shows it, then click it like a user.
    await cdp.send('Page.reload')
    await sleep(2500)

    const clicked = await cdp.eval(`
      const cards = [...document.querySelectorAll('.lib-card')];
      const card = cards.find(c => /sample/i.test(c.textContent)) ?? cards[0];
      if (!card) return { error: 'no library cards' };
      card.click();
      return { cards: cards.length, clicked: card.querySelector('.name')?.textContent };
    `)
    log('library', JSON.stringify(clicked))
    check('document appears in the library', clicked?.cards >= 1, JSON.stringify(clicked))
    await sleep(4000)
    await cdp.screenshot(`${OUT}/02-document.png`)

    const state = await cdp.eval(`
      return {
        pages: document.querySelectorAll('.page').length,
        canvases: document.querySelectorAll('.page canvas').length,
        spans: document.querySelectorAll('.textLayer span').length,
        title: document.querySelector('.doc-title')?.textContent ?? null,
        total: document.querySelector('.toolbar span:nth-of-type(2)')?.textContent ?? null
      };
    `)
    log('viewer state', JSON.stringify(state))
    check('all pages laid out', state.pages === 60, `(got ${state.pages})`)
    check('only visible pages rasterised', state.canvases > 0 && state.canvases <= 6,
      `(got ${state.canvases} canvases)`)
    check('text layer rendered', state.spans > 0, `(got ${state.spans} spans)`)

    // ---- text-layer alignment -------------------------------------------
    // The acid test for --total-scale-factor: a text span's box must sit inside
    // the page box, at a plausible position for the text it contains.
    const align = await cdp.eval(`
      const page = document.querySelector('.page');
      const span = page.querySelector('.textLayer span');
      const p = page.getBoundingClientRect();
      const s = span.getBoundingClientRect();
      return {
        text: span.textContent.slice(0, 40),
        insideX: s.left >= p.left - 2 && s.right <= p.right + 2,
        insideY: s.top >= p.top - 2 && s.bottom <= p.bottom + 2,
        w: Math.round(s.width), h: Math.round(s.height),
        pageW: Math.round(p.width)
      };
    `)
    log('text alignment', JSON.stringify(align))
    check('text spans sit inside the page box', align.insideX && align.insideY)
    check('text spans have a sane size', align.h > 4 && align.h < 80 && align.w > 1)

    // ---- create a highlight from a real DOM selection --------------------
    const made = await cdp.eval(`
      const page = document.querySelector('.page[data-page="1"]');
      const spans = [...page.querySelectorAll('.textLayer span')].filter(s => s.textContent.trim());
      const range = document.createRange();
      range.setStart(spans[1].firstChild, 0);
      range.setEnd(spans[3].firstChild, Math.max(1, spans[3].firstChild.length - 1));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      page.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const popup = document.querySelector('.selection-popup');
      if (!popup) return { error: 'no popup', text: sel.toString().slice(0,60) };
      popup.querySelectorAll('.swatch')[1].click();
      await new Promise(r => setTimeout(r, 600));
      const stored = await window.api.annotations.listByDoc($DOCID);
      return {
        quoted: stored[0]?.quotedText?.slice(0, 50) ?? null,
        storedRects: stored[0]?.rects?.length ?? 0,
        color: stored[0]?.color ?? null,
        rects: document.querySelectorAll('.highlight-layer .rect').length,
        sidebar: document.querySelectorAll('.ann-item').length
      };
    `.replace('$DOCID', String(opened.id)))
    log('highlight creation', JSON.stringify(made))
    check('selection popup appeared and highlight drawn', made.rects > 0, JSON.stringify(made))
    check('highlight listed in sidebar', made.sidebar === 1, JSON.stringify(made))
    check('quoted text was captured', (made.quoted ?? '').length > 5, JSON.stringify(made))
    check('per-line rects were stored', made.storedRects >= 2, JSON.stringify(made))
    await cdp.screenshot(`${OUT}/03-highlight.png`)

    // ---- attach a note ---------------------------------------------------
    const noted = await cdp.eval(`
      const item = document.querySelector('.ann-item');
      [...item.querySelectorAll('button')].find(b => b.textContent.includes('Add note')).click();
      await new Promise(r => setTimeout(r, 200));
      const ta = item.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'This is my note about the fox.');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      [...item.querySelectorAll('button')].find(b => b.textContent === 'Save').click();
      await new Promise(r => setTimeout(r, 700));
      const hs = await window.api.annotations.listByDoc(${'$DOCID'});
      return { note: hs[0]?.note ?? null, count: hs.length };
    `.replace('$DOCID', String(opened.id)))
    log('note', JSON.stringify(noted))
    check('note persisted to the database', noted.note === 'This is my note about the fox.',
      JSON.stringify(noted))
    await cdp.screenshot(`${OUT}/04-note.png`)

    // ---- zoom: highlight geometry must follow -----------------------------
    const zoomBefore = await cdp.eval(`
      const rectEl = document.querySelector('.highlight-layer .rect');
      const pageEl = document.querySelector('.page[data-page="1"]');
      return {
        rectW: rectEl?.getBoundingClientRect().width ?? null,
        pageW: pageEl?.getBoundingClientRect().width ?? null
      };
    `)
    await cdp.eval(`
      [...document.querySelectorAll('.toolbar button')].find(b => b.textContent === '+').click();
      return true;
    `)
    const zoomed = await waitFor(
      cdp,
      `
      const rectEl = document.querySelector('.highlight-layer .rect');
      const pageEl = document.querySelector('.page[data-page="1"]');
      const rectW = rectEl?.getBoundingClientRect().width ?? null;
      const pageW = pageEl?.getBoundingClientRect().width ?? null;
      return {
        rectW, pageW,
        ratioPage: pageW && ${zoomBefore.pageW} ? pageW / ${zoomBefore.pageW} : null,
        ratioRect: rectW && ${zoomBefore.rectW} ? rectW / ${zoomBefore.rectW} : null,
        zoomLabel: [...document.querySelectorAll('.toolbar span')].map(s => s.textContent).find(t => /%/.test(t)) ?? null
      };
      `,
      (v) => v.ratioRect !== null && v.ratioPage !== null && v.ratioPage > 1.05,
      { label: 'zoom', timeout: 25000 }
    )
    zoomed.pageGrew = zoomed.ratioPage > 1.05
    log('zoom', JSON.stringify(zoomed))
    check('page grew on zoom', zoomed.pageGrew, JSON.stringify(zoomed))
    check('highlight scaled with the page',
      Math.abs(zoomed.ratioRect - zoomed.ratioPage) < 0.06, JSON.stringify(zoomed))
    await cdp.screenshot(`${OUT}/05-zoomed.png`)

    // ---- zoom must not move the reader to a different page -----------------
    await cdp.eval(`document.querySelector('.viewer').scrollTop = 20000; return true;`)
    const anchored = await waitFor(
      cdp,
      `return { page: document.querySelector('.page-input').value };`,
      (v) => v.page !== null && v.page !== '1',
      { label: 'scroll to mid-document', timeout: 15000 }
    )
    const startPage = anchored.page
    log('anchored at page', startPage)

    const drift = []
    for (const btn of ['+', '+', '−', '−', '+']) {
      await cdp.eval(
        `[...document.querySelectorAll('.toolbar button')]
           .find(b => b.textContent === ${JSON.stringify(btn)}).click(); return true;`
      )
      const at = await waitFor(
        cdp,
        `return { page: document.querySelector('.page-input').value,
                  zoom: [...document.querySelectorAll('.toolbar span')]
                          .map(s => s.textContent).find(t => /%/.test(t)) ?? null };`,
        (v) => v.page === startPage,
        { label: `zoom ${btn}`, timeout: 12000 }
      )
      drift.push(`${btn}→${at.zoom}:p${at.page}`)
    }
    log('zoom sequence', drift.join(' '))
    check(
      'zooming keeps the reader on the same page',
      drift.every((d) => d.endsWith(`p${startPage}`)),
      `started on p${startPage}, got ${drift.join(' ')}`
    )

    // ---- search ----------------------------------------------------------
    await cdp.eval(`
      [...document.querySelectorAll('.sidebar-tabs button')].find(b => b.textContent.includes('Search')).click();
      await new Promise(r => setTimeout(r, 200));
      const input = document.querySelector('.search-bar input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'zebra-042-quartz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    const searched = await waitFor(
      cdp,
      `
      const results = [...document.querySelectorAll('.search-result')];
      return {
        count: results.length,
        first: results[0]?.textContent.slice(0, 70) ?? null,
        countLabel: document.querySelector('.search-count')?.textContent ?? null
      };
      `,
      (v) => v.count >= 1 && !/…/.test(v.countLabel ?? '…'),
      { label: 'search', timeout: 30000 }
    )
    log('search', JSON.stringify(searched))
    check('search found the unique marker', searched.count >= 1, JSON.stringify(searched))

    await cdp.eval(`document.querySelector('.search-result').click(); return true;`)
    const jumped = await waitFor(
      cdp,
      `
      return {
        page: document.querySelector('.page-input')?.value ?? null,
        hits: document.querySelectorAll('.search-hit-layer .rect').length,
        scrollTop: Math.round(document.querySelector('.viewer').scrollTop)
      };
      `,
      (v) => v.page === '42' && v.hits > 0,
      { label: 'search jump', timeout: 25000 }
    )
    log('search jump', JSON.stringify(jumped))
    check('clicking a result navigates to its page', jumped.page === '42', JSON.stringify(jumped))
    check('search hit is drawn on the page', jumped.hits > 0, JSON.stringify(jumped))
    await cdp.screenshot(`${OUT}/06-search.png`)

    // ---- multi-item match -------------------------------------------------
    await cdp.eval(`
      const input = document.querySelector('.search-bar input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'quick brown fox');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    const crossItem = await waitFor(
      cdp,
      `return { count: document.querySelectorAll('.search-result').length,
                label: document.querySelector('.search-count')?.textContent ?? null };`,
      (v) => v.count > 10,
      { label: 'multi-word search', timeout: 40000 }
    )
    log('multi-word search', JSON.stringify(crossItem))
    check('multi-word phrase found across text items', crossItem.count > 10, JSON.stringify(crossItem))

    // ---- outline ----------------------------------------------------------
    const outlineRows = await waitFor(
      cdp,
      `
      const tabs = [...document.querySelectorAll('.sidebar-tabs button')];
      const t = tabs.find(b => b.textContent.includes('Outline'));
      if (t && t.getAttribute('aria-selected') !== 'true') t.click();
      const rows = [...document.querySelectorAll('.outline-row')];
      return { rows: rows.length, titles: rows.slice(0, 5).map(r => r.textContent.trim()) };
      `,
      (v) => v.rows > 5,
      { label: 'outline build', timeout: 20000 }
    )
    log('outline titles', JSON.stringify(outlineRows.titles))

    await cdp.eval(`
      const target = [...document.querySelectorAll('.outline-row')]
        .find(r => r.textContent.trim() === 'Section 31');
      if (target) target.click();
      return !!target;
    `)
    const outline = await waitFor(
      cdp,
      `return { rows: document.querySelectorAll('.outline-row').length,
                page: document.querySelector('.page-input')?.value ?? null };`,
      (v) => v.page === '31',
      { label: 'outline nav', timeout: 25000 }
    )
    log('outline', JSON.stringify(outline))
    check('outline tree built', outlineRows.rows > 5, JSON.stringify(outlineRows))
    check('outline navigates to the right page', outline.page === '31', JSON.stringify(outline))
    await cdp.screenshot(`${OUT}/07-outline.png`)

    // ---- reading modes -----------------------------------------------------
    const modeProbe = `
      const root = getComputedStyle(document.documentElement);
      const canvas = getComputedStyle(document.querySelector('.page canvas'));
      const layer = getComputedStyle(document.querySelector('.highlight-layer'));
      const page = getComputedStyle(document.querySelector('.page'));
      return {
        canvasFilter: canvas.filter,
        pageFilter: page.filter,
        blend: layer.mixBlendMode,
        backdrop: root.getPropertyValue('--page-backdrop').trim()
      };`

    const probes = {}
    for (const [label, file] of [['Dark', '08-dark.png'], ['Sepia', '09-sepia.png']]) {
      await cdp.eval(`
        const t = [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('◐'));
        if (!document.querySelector('.popover')) t.click();
        await new Promise(r => setTimeout(r, 250));
        [...document.querySelectorAll('.popover .mode-row button')].find(b => b.textContent === '${label}').click();
        await new Promise(r => setTimeout(r, 600));
        return true;
      `)
      probes[label] = await cdp.eval(modeProbe)
      log(label, JSON.stringify(probes[label]))
      await cdp.screenshot(`${OUT}/${file}`)
    }

    check('dark mode inverts the canvas', /invert/.test(probes.Dark.canvasFilter),
      JSON.stringify(probes.Dark))
    check('dark mode switches highlight blending to screen', probes.Dark.blend === 'screen',
      JSON.stringify(probes.Dark))
    check('sepia mode tints without inverting',
      /sepia/.test(probes.Sepia.canvasFilter) && !/invert/.test(probes.Sepia.canvasFilter),
      JSON.stringify(probes.Sepia))
    check('sepia keeps multiply blending', probes.Sepia.blend === 'multiply',
      JSON.stringify(probes.Sepia))

    const filters = await cdp.eval(`
      const root = getComputedStyle(document.documentElement);
      const canvas = getComputedStyle(document.querySelector('.page canvas'));
      const layer = getComputedStyle(document.querySelector('.highlight-layer'));
      const page = getComputedStyle(document.querySelector('.page'));
      return {
        canvasFilter: canvas.filter,
        pageFilter: page.filter,
        blend: layer.mixBlendMode,
        backdrop: root.getPropertyValue('--page-backdrop').trim()
      };
    `)
    log('reading mode', JSON.stringify(filters))
    check('filter applies to the canvas', filters.canvasFilter !== 'none', JSON.stringify(filters))
    check('filter does NOT apply to the page container', filters.pageFilter === 'none',
      JSON.stringify(filters))

    // Back to normal, then close the popover.
    await cdp.eval(`
      [...document.querySelectorAll('.popover .mode-row button')].find(b => b.textContent === 'Normal').click();
      await new Promise(r => setTimeout(r, 300));
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return true;
    `)

    // ---- export / import round trip ---------------------------------------
    // The dialog-free halves of the feature. saveExport and pickImportFile open
    // OS-modal dialogs that would block CDP, so they are not driven here.
    const exported = await cdp.eval(`
      globalThis.__bundle = await window.api.transfer.buildExport($DOCID);
      const b = JSON.parse(globalThis.__bundle);
      return {
        format: b.format,
        version: b.version,
        shaLen: b.document.sha256.length,
        count: b.highlights.length,
        note: b.highlights[0]?.note ?? null,
        rects: b.highlights[0]?.rects?.length ?? 0
      };
    `.replace('$DOCID', String(opened.id)))
    log('exported', JSON.stringify(exported))
    check('export is a versioned marmalade bundle',
      exported.format === 'marmalade-annotations' && exported.version === 1,
      JSON.stringify(exported))
    check('export carries the document sha-256', exported.shaLen === 64, JSON.stringify(exported))
    check('export carries the highlight and its note',
      exported.count === 1 && exported.note === 'This is my note about the fox.' && exported.rects > 0,
      JSON.stringify(exported))

    const foreign = await cdp.eval(`
      const b = JSON.parse(globalThis.__bundle);
      b.document.sha256 = 'f'.repeat(64);
      return await window.api.transfer.inspect(JSON.stringify(b));
    `)
    check('an unknown pdf resolves to no match', foreign.match.kind === 'none',
      JSON.stringify(foreign.match))

    const rejected = await cdp.eval(`
      const out = {};
      for (const [key, text] of [['notJson', 'nonsense'], ['wrongFile', '{"a":1}']]) {
        try { await window.api.transfer.inspect(text); out[key] = null }
        catch (e) { out[key] = e.message }
      }
      return out;
    `)
    check('a non-json file is rejected', /not valid JSON/.test(rejected.notJson ?? ''), rejected.notJson)
    check('an unrelated json file is rejected',
      /not a Marmalade annotations export/.test(rejected.wrongFile ?? ''), rejected.wrongFile)

    const roundTrip = await cdp.eval(`
      const before = await window.api.annotations.listByDoc($DOCID);
      for (const h of before) await window.api.annotations.deleteHl(h.id);

      const preview = await window.api.transfer.inspect(globalThis.__bundle);
      const first = await window.api.transfer.apply(globalThis.__bundle, $DOCID);
      const restored = await window.api.annotations.listByDoc($DOCID);
      const again = await window.api.transfer.apply(globalThis.__bundle, $DOCID);

      return {
        match: preview.match.kind,
        matchedDoc: preview.match.docId ?? null,
        noteCount: preview.noteCount,
        first,
        again,
        restoredCount: restored.length,
        restoredNote: restored[0]?.note ?? null,
        restoredColor: restored[0]?.color ?? null,
        restoredCreated: restored[0]?.createdAt ?? null,
        originalColor: JSON.parse(globalThis.__bundle).highlights[0].color,
        originalCreated: JSON.parse(globalThis.__bundle).highlights[0].createdAt
      };
    `.replaceAll('$DOCID', String(opened.id)))
    log('round trip', JSON.stringify(roundTrip))
    check('import finds the document by sha-256',
      roundTrip.match === 'exact' && roundTrip.matchedDoc === opened.id, JSON.stringify(roundTrip))
    check('import restores the highlight and its note',
      roundTrip.first.added === 1 && roundTrip.first.notesAdded === 1 &&
        roundTrip.restoredCount === 1 && roundTrip.restoredNote === 'This is my note about the fox.',
      JSON.stringify(roundTrip))
    check('import preserves the original colour and timestamp',
      roundTrip.restoredColor === roundTrip.originalColor &&
        roundTrip.restoredCreated === roundTrip.originalCreated,
      JSON.stringify(roundTrip))
    check('re-importing the same file adds nothing',
      roundTrip.again.added === 0 && roundTrip.again.skippedDuplicate === 1,
      JSON.stringify(roundTrip.again))

    const outOfRange = await cdp.eval(`
      const b = JSON.parse(globalThis.__bundle);
      b.highlights[0].page = 99999;
      b.highlights[0].rects[0].x0 = 0.5;
      return await window.api.transfer.apply(JSON.stringify(b), $DOCID);
    `.replace('$DOCID', String(opened.id)))
    check('a highlight past the last page is skipped, not stored',
      outOfRange.added === 0 && outOfRange.skippedOutOfRange === 1, JSON.stringify(outOfRange))

    // ---- the import modal, and the drop guard around it ---------------------
    const modal = await cdp.eval(`
      [...document.querySelectorAll('.toolbar button')]
        .find(b => b.textContent.includes('Import')).click();
      await new Promise(r => setTimeout(r, 300));
      const open = !!document.querySelector('.modal .dropzone');

      const dt = new DataTransfer();
      dt.items.add(new File([globalThis.__bundle], 'x.mmnotes.json', { type: 'application/json' }));
      document.querySelector('.dropzone')
        .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      await new Promise(r => setTimeout(r, 700));
      const summary = document.querySelector('.modal .import-summary')?.textContent ?? null;

      // A drop that misses the zone must not navigate the renderer away.
      const stray = new DragEvent('drop', { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true });
      document.body.dispatchEvent(stray);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return {
        open,
        summary,
        strayPrevented: stray.defaultPrevented,
        stillReader: !!document.querySelector('.toolbar'),
        closed: !document.querySelector('.modal')
      };
    `)
    log('import modal', JSON.stringify(modal))
    check('the import modal opens with a drop zone', modal.open === true, JSON.stringify(modal))
    check('dropping a bundle shows its preview',
      /highlight/.test(modal.summary ?? ''), JSON.stringify(modal.summary))
    check('a stray file drop cannot navigate the app away',
      modal.strayPrevented === true && modal.stillReader === true, JSON.stringify(modal))
    check('Escape closes the import modal', modal.closed === true, JSON.stringify(modal))
    await cdp.screenshot(`${OUT}/09b-import.png`)

    // ---- persistence across a reload --------------------------------------
    await cdp.send('Page.reload')
    await sleep(3000)
    const afterReload = await cdp.eval(`
      const hs = await window.api.annotations.listByDoc(${opened.id});
      const docs = await window.api.library.list();
      return {
        highlights: hs.length,
        note: hs[0]?.note ?? null,
        rects: hs[0]?.rects?.length ?? 0,
        libraryCount: docs.length,
        lastPage: docs.find(d => d.id === ${opened.id})?.lastPage ?? null
      };
    `)
    log('after reload', JSON.stringify(afterReload))
    check('highlight survives a restart', afterReload.highlights === 1, JSON.stringify(afterReload))
    check('note survives a restart', afterReload.note === 'This is my note about the fox.',
      JSON.stringify(afterReload))
    check('reading position was saved', afterReload.lastPage > 1, JSON.stringify(afterReload))
    check('document is in the library', afterReload.libraryCount >= 1, JSON.stringify(afterReload))
    await cdp.screenshot(`${OUT}/10-reloaded.png`)

    // ---- console errors ----------------------------------------------------
    const consoleErrors = rendererLogs
      .join('')
      .split('\n')
      .filter((l) => /error|Error|SEVERE/.test(l))
      .filter((l) => !/devtools|DevTools|Autofill|GPU|gpu_|dxgi|Vulkan|cache|Request Autofill/i.test(l))
      // The malformed-import checks above provoke these on purpose.
      .filter(
        (l) =>
          !/handler for 'transfer:inspect'.*(not valid JSON|not a Marmalade annotations export)/.test(l)
      )
    log('filtered console errors:', consoleErrors.length)
    for (const e of consoleErrors.slice(0, 12)) log('  |', e.trim())
    check('no unexpected console errors', consoleErrors.length === 0)
  } catch (err) {
    log('--- app output ---')
    console.log(rendererLogs.join('').slice(-6000))
    throw err
  } finally {
    cdp?.close()
    child.kill()
  }

  log('')
  if (failures.length === 0) {
    log('ALL CHECKS PASSED')
  } else {
    log(`${failures.length} CHECK(S) FAILED:`)
    for (const f of failures) log('  -', f)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[smoke] fatal', err)
  process.exit(1)
})
