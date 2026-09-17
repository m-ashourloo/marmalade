/**
 * Renders a CJK document and screenshots it, to confirm the pdf.js cmaps and
 * standard_fonts directories are reachable at runtime. Without them CJK glyphs
 * render blank, which no unit test would catch.
 *
 * Usage: node scripts/cjk-check.mjs <pdf> <out-dir>
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electronPath from 'electron'

const PDF = resolve(process.argv[2])
const OUT = resolve(process.argv[3] ?? 'cjk-out')
const PORT = 9224
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[cjk]', ...a)

/** Poll until `ok(value)` or timeout, so results do not depend on machine load. */
async function waitFor(evaluate, expr, ok, { timeout = 25000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const v = await evaluate(expr)
    if (ok(v)) return v
    if (Date.now() > deadline) return v
    await new Promise((r) => setTimeout(r, interval))
  }
}


async function rpc(ws, method, params = {}, id = Math.floor(Math.random() * 1e6)) {
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== id) return
      ws.removeEventListener('message', onMsg)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
    ws.addEventListener('message', onMsg)
    setTimeout(() => rej(new Error(`${method} timed out`)), 60000)
  })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const userData = resolve(OUT, 'userdata')
  await rm(userData, { recursive: true, force: true })

  const child = spawn(
    electronPath,
    ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const logs = []
  child.stdout.on('data', (d) => logs.push(String(d)))
  child.stderr.on('data', (d) => logs.push(String(d)))

  let ws
  try {
    let target
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
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

    const evaluate = async (expr) => {
      const r = await rpc(ws, 'Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true,
        returnByValue: true
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
      return r.result.value
    }

    await evaluate(`await window.api.doc.open(${JSON.stringify(PDF)}); return true;`)
    await rpc(ws, 'Page.reload')
    await sleep(2500)
    await evaluate(`document.querySelector('.lib-card').click(); return true;`)

    const info = await waitFor(evaluate, `
      const spans = [...document.querySelectorAll('.textLayer span')];
      const canvas = document.querySelector('.page canvas');
      if (!canvas) return { spanCount: 0, text: '', inkPixels: 0, totalPixels: 1 };
      // Count non-white pixels: blank glyphs would leave the page almost empty.
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) ink++;
      return {
        spanCount: spans.length,
        text: spans.map(s => s.textContent).join('').slice(0, 80),
        inkPixels: ink,
        totalPixels: d.length / 4
      };
    `, (v) => v.spanCount > 0 && v.inkPixels > 0, { timeout: 30000 })
    log('render info', JSON.stringify(info))

    const { data } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/cjk.png`, Buffer.from(data, 'base64'))
    log('screenshot →', `${OUT}/cjk.png`)

    const inkRatio = info.inkPixels / info.totalPixels
    log('ink ratio', inkRatio.toFixed(5))
    if (info.spanCount === 0) throw new Error('no text layer spans')
    if (inkRatio < 0.001) throw new Error(`page looks blank (ink ratio ${inkRatio})`)
    log('PASS: CJK page rendered with glyphs and a text layer')
  } catch (err) {
    log('--- app output ---')
    console.log(logs.join('').slice(-4000))
    throw err
  } finally {
    ws?.close()
    child.kill()
  }
}

main().catch((e) => {
  console.error('[cjk] FAILED', e.message)
  process.exit(1)
})
