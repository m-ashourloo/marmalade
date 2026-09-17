/**
 * Drives a REAL mouse drag through CDP Input events, rather than building a
 * Range in JavaScript. Only this path exercises the browser's own text-selection
 * machinery, hit-testing and z-order — a synthetic Range bypasses all of it, so
 * the smoke test cannot catch a selection that is broken for an actual user.
 *
 * Usage: node scripts/real-mouse-check.mjs <pdf> <out-dir>
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electronPath from 'electron'

const PDF = resolve(process.argv[2])
const OUT = resolve(process.argv[3] ?? 'mouse-out')
const PORT = 9227
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[mouse]', ...a)

function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      ws.removeEventListener('message', h)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
    ws.addEventListener('message', h)
    setTimeout(() => rej(new Error(`${method} timed out`)), 30000)
  })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const userData = resolve(OUT, 'userdata')
  await rm(userData, { recursive: true, force: true })

  const child = spawn(
    electronPath,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    { cwd: process.cwd(), env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const logs = []
  child.stdout.on('data', (d) => logs.push(String(d)))
  child.stderr.on('data', (d) => logs.push(String(d)))

  let ws
  try {
    let target
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      } catch {
        /* not up */
      }
      if (!target) await sleep(250)
    }
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })
    await rpc(ws, 'Page.enable')
    await rpc(ws, 'Runtime.enable')
    await sleep(1500)

    const ev = async (expr) => {
      const r = await rpc(ws, 'Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true,
        returnByValue: true
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
      return r.result.value
    }

    await ev(`await window.api.doc.open(${JSON.stringify(PDF)}); return true;`)
    await rpc(ws, 'Page.reload')
    await sleep(2500)
    await ev(`document.querySelector('.lib-card').click(); return true;`)

    // Wait for a rendered text layer.
    for (let i = 0; i < 60; i++) {
      const n = await ev(`return document.querySelectorAll('.textLayer span').length;`)
      if (n > 0) break
      await sleep(400)
    }

    // Pick the on-screen box of a line of body text to drag across.
    const box = await ev(`
      const spans = [...document.querySelectorAll('.page[data-page="1"] .textLayer span')]
        .filter(s => s.textContent.trim().length > 25);
      if (!spans.length) return null;
      const r = spans[0].getBoundingClientRect();
      return { x0: r.left + 3, y: r.top + r.height / 2, x1: r.right - 3, text: spans[0].textContent.slice(0, 40) };
    `)
    log('drag target', JSON.stringify(box))
    if (!box) throw new Error('no text span to drag across')

    // A genuine press-drag-release at the OS input layer.
    const mouse = (type, x, y, extra = {}) =>
      rpc(ws, 'Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
        ...extra
      })

    await mouse('mousePressed', box.x0, box.y)
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', box.x0 + ((box.x1 - box.x0) * i) / steps, box.y)
      await sleep(25)
    }
    await mouse('mouseReleased', box.x1, box.y)
    await sleep(700)

    const afterDrag = await ev(`
      return {
        selected: (window.getSelection()?.toString() ?? '').slice(0, 60),
        popupVisible: !!document.querySelector('.selection-popup'),
        swatches: document.querySelectorAll('.selection-popup .swatch').length
      };
    `)
    log('after drag', JSON.stringify(afterDrag))

    const { data } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/after-drag.png`, Buffer.from(data, 'base64'))
    log('screenshot →', `${OUT}/after-drag.png`)

    if (!afterDrag.selected) throw new Error('REAL MOUSE DRAG SELECTED NO TEXT')
    if (!afterDrag.popupVisible) throw new Error('selection made, but the colour popup never appeared')

    // Click a swatch with a real mouse click too.
    const swatch = await ev(`
      const s = document.querySelectorAll('.selection-popup .swatch')[0];
      const r = s.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `)
    await mouse('mousePressed', swatch.x, swatch.y)
    await mouse('mouseReleased', swatch.x, swatch.y)
    await sleep(1200)

    const result = await ev(`
      const stored = await window.api.annotations.listByDoc(1);
      return {
        stored: stored.length,
        quoted: stored[0]?.quotedText?.slice(0, 50) ?? null,
        drawn: document.querySelectorAll('.highlight-layer .rect').length,
        sidebar: document.querySelectorAll('.ann-item').length
      };
    `)
    log('after swatch click', JSON.stringify(result))

    const { data: d2 } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/after-highlight.png`, Buffer.from(d2, 'base64'))

    if (result.stored !== 1) throw new Error('clicking the swatch did not create a highlight')
    if (result.drawn === 0) throw new Error('highlight stored but not drawn on the page')
    log('PASS: real mouse drag → popup → highlight works')

    // ---- the note flow, also with real input --------------------------------
    const clickText = async (label) => {
      const at = await ev(`
        const b = [...document.querySelectorAll('.ann-item button')]
          .find(b => b.textContent.trim() === ${JSON.stringify(label)});
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      `)
      if (!at) throw new Error(`no "${label}" button in the sidebar`)
      await mouse('mousePressed', at.x, at.y)
      await mouse('mouseReleased', at.x, at.y)
      await sleep(500)
    }

    await clickText('Add note')
    const hasBox = await ev(`return !!document.querySelector('.ann-item textarea');`)
    if (!hasBox) throw new Error('"Add note" did not open an editor')

    // Click into the textarea, then type as a person would.
    const ta = await ev(`
      const r = document.querySelector('.ann-item textarea').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 12 };
    `)
    await mouse('mousePressed', ta.x, ta.y)
    await mouse('mouseReleased', ta.x, ta.y)
    await sleep(200)

    const NOTE = 'Typed with real key events.'
    for (const ch of NOTE) {
      await rpc(ws, 'Input.dispatchKeyEvent', { type: 'char', text: ch })
    }
    await sleep(300)

    const typed = await ev(`return document.querySelector('.ann-item textarea')?.value ?? null;`)
    log('typed value', JSON.stringify(typed))
    if (typed !== NOTE) throw new Error(`typing did not reach the textarea (got ${typed})`)

    await clickText('Save')
    const noteResult = await ev(`
      const stored = await window.api.annotations.listByDoc(1);
      return {
        note: stored[0]?.note ?? null,
        shownInSidebar: document.querySelector('.ann-item .note-body')?.textContent ?? null,
        editorClosed: !document.querySelector('.ann-item textarea')
      };
    `)
    log('note result', JSON.stringify(noteResult))

    const { data: d3 } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/after-note.png`, Buffer.from(d3, 'base64'))

    if (noteResult.note !== NOTE) throw new Error('note was not saved to the database')
    if (noteResult.shownInSidebar !== NOTE) throw new Error('note saved but not shown in the sidebar')
    if (!noteResult.editorClosed) throw new Error('editor stayed open after Save')
    log('PASS: real click → Add note → type → Save works')
  } catch (err) {
    log('--- app output ---')
    console.log(
      logs.join('').split('\n').filter((l) => /error|CONSOLE/i.test(l)).slice(-15).join('\n')
    )
    throw err
  } finally {
    ws?.close()
    child.kill()
  }
}

main().catch((e) => {
  console.error('[mouse] FAILED:', e.message)
  process.exit(1)
})
