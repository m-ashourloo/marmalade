/**
 * Verifies the double-click path: launching the installed executable with a .pdf
 * argument must open that document, and a second launch must hand the file to the
 * running instance rather than starting a second copy.
 *
 * Usage: node scripts/association-check.mjs "<installed exe>" <pdf-a> <pdf-b>
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const EXE = process.argv[2]
const PDF_A = resolve(process.argv[3])
const PDF_B = resolve(process.argv[4])
const PORT = 9229
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[assoc]', ...a)
const failures = []
const check = (n, ok, d = '') => { if (ok) log('PASS ', n); else { log('FAIL ', n, d); failures.push(n) } }

function rpc(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    const h = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return
      ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
    ws.addEventListener('message', h)
    setTimeout(() => rej(new Error(method)), 30000)
  })
}

const procs = []
try {
  // First launch: the PDF arrives on the command line, as it does from Explorer.
  procs.push(spawn(EXE, [`--remote-debugging-port=${PORT}`, PDF_A], { stdio: 'ignore', detached: false }))

  let target
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('app never started')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  await rpc(ws, 'Runtime.enable')

  const ev = async (e) => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: `(async()=>{${e}})()`, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
    return r.result.value
  }

  let opened = null
  for (let i = 0; i < 60; i++) {
    opened = await ev(`return { title: document.querySelector('.doc-title')?.textContent ?? null,
                                pages: document.querySelectorAll('.page').length };`)
    if (opened.pages > 0) break
    await sleep(500)
  }
  log('after launch with argument:', JSON.stringify(opened))
  check('launching with a .pdf argument opens that document', opened.pages > 0, JSON.stringify(opened))

  // Second launch with a different file: single-instance should route it to the
  // running window instead of starting another copy.
  const before = opened.title
  const second = spawn(EXE, [PDF_B], { stdio: 'ignore' })
  procs.push(second)
  await sleep(6000)

  let routed = null
  for (let i = 0; i < 40; i++) {
    routed = await ev(`return { title: document.querySelector('.doc-title')?.textContent ?? null,
                                pages: document.querySelectorAll('.page').length };`)
    if (routed.title && routed.title !== before) break
    await sleep(500)
  }
  log('after second launch:', JSON.stringify(routed), '(was', before + ')')
  check('a second launch opens the new file in the existing window',
    routed.title !== before && routed.pages > 0, JSON.stringify(routed))

  // Poll rather than await an 'exit' event: the process often exits before the
  // listener is attached, which would look like a failure.
  let exited = second.exitCode !== null
  for (let i = 0; i < 20 && !exited; i++) { await sleep(400); exited = second.exitCode !== null }
  check('the second process exits instead of becoming a duplicate instance', exited,
    `exitCode=${second.exitCode}`)

  ws.close()
} finally {
  for (const p of procs) { try { p.kill() } catch { /* ignore */ } }
}

if (failures.length) { log(`${failures.length} FAILED`); process.exit(1) }
log('ALL ASSOCIATION CHECKS PASSED')
