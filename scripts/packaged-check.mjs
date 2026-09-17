/**
 * Drives the PACKAGED app (dist/win-unpacked) rather than the dev build, to
 * confirm the things only packaging can break: better-sqlite3 loading from
 * app.asar.unpacked, pdf.js assets resolving inside the asar, and the strict CSP
 * that is only applied when app.isPackaged.
 *
 * Usage: node scripts/packaged-check.mjs <exe> <pdf> <out-dir>
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXE = resolve(process.argv[2])
const PDF = resolve(process.argv[3])
const OUT = resolve(process.argv[4] ?? 'packaged-out')
const PORT = 9225
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[packaged]', ...a)

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


const failures = []
const check = (name, ok, detail = '') => {
  if (ok) log(`PASS  ${name}`)
  else {
    log(`FAIL  ${name} ${detail}`)
    failures.push(name)
  }
}

function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
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
    EXE,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const logs = []
  child.stdout.on('data', (d) => logs.push(String(d)))
  child.stderr.on('data', (d) => logs.push(String(d)))

  let ws
  try {
    let target
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(250)
    }
    if (!target) throw new Error('packaged app never exposed a renderer')

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })
    await rpc(ws, 'Page.enable')
    await rpc(ws, 'Runtime.enable')
    await sleep(2000)

    const evaluate = async (expr) => {
      const r = await rpc(ws, 'Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true,
        returnByValue: true
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
      return r.result.value
    }

    check('packaged app launched and rendered', true)

    // Any library query proves better-sqlite3 loaded from app.asar.unpacked and
    // the schema migrated — this is the day-one native-module risk.
    const list = await evaluate('return await window.api.library.list();')
    check('better-sqlite3 loads in the packaged app', Array.isArray(list),
      JSON.stringify(list).slice(0, 80))

    const opened = await evaluate(
      `const r = await window.api.doc.open(${JSON.stringify(PDF)}); return r.doc.id;`
    )
    check('document opens from the packaged app', typeof opened === 'number')

    await rpc(ws, 'Page.reload')
    await sleep(2500)
    await evaluate(`document.querySelector('.lib-card')?.click(); return true;`)

    const state = await waitFor(
      evaluate,
      `return {
        canvases: document.querySelectorAll('.page canvas').length,
        spans: document.querySelectorAll('.textLayer span').length,
        pages: document.querySelectorAll('.page').length
      };`,
      (v) => v.canvases > 0 && v.spans > 0,
      { timeout: 30000 }
    )
    log('render state', JSON.stringify(state))
    check('pdf.js renders inside the asar', state.canvases > 0 && state.spans > 0,
      JSON.stringify(state))

    // The worker only starts if worker-src 'self' is satisfied by the bundled
    // module worker; a blob worker would be blocked by the packaged CSP.
    const csp = await evaluate(`
      const res = await fetch(location.href);
      return res.headers.get('content-security-policy');
    `)
    log('CSP', csp)
    check('strict CSP is applied when packaged', typeof csp === 'string' && csp.includes("worker-src 'self'"), String(csp))

    // A highlight round-trip proves writes reach the packaged database file.
    const round = await evaluate(`
      const h = await window.api.annotations.createHl({
        docId: ${opened}, page: 1, color: 'yellow',
        rects: [{ x0: 0.1, y0: 0.8, x1: 0.6, y1: 0.83 }],
        quotedText: 'packaged round trip'
      });
      const withNote = await window.api.annotations.upsertNote(h.id, 'note from packaged build');
      const back = await window.api.annotations.listByDoc(${opened});
      return { count: back.length, note: back[0]?.note ?? null, quoted: back[0]?.quotedText };
    `)
    log('db round trip', JSON.stringify(round))
    check('highlights and notes persist in the packaged build',
      round.count === 1 && round.note === 'note from packaged build', JSON.stringify(round))

    const { data } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/packaged.png`, Buffer.from(data, 'base64'))
    log('screenshot →', `${OUT}/packaged.png`)

    const errors = logs
      .join('')
      .split('\n')
      .filter((l) => /error|refused|blocked/i.test(l))
      .filter((l) => !/devtools|gpu|dxgi|vulkan|autofill|cache/i.test(l))
    log('app-level errors:', errors.length)
    for (const e of errors.slice(0, 10)) log('  |', e.trim())
    check('no CSP violations or load errors', errors.length === 0)
  } finally {
    ws?.close()
    child.kill()
  }

  if (failures.length) {
    log(`${failures.length} FAILED: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    log('ALL PACKAGED CHECKS PASSED')
  }
}

main().catch((e) => {
  console.error('[packaged] fatal', e.message)
  process.exit(1)
})
