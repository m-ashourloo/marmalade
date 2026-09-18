/**
 * Interactive driver for the PDF Reader Electron app.
 *
 * Reads commands on stdin (one per line) and drives a real running instance over
 * the Chrome DevTools Protocol. Built for agents: pipe a heredoc in, read the
 * output, look at the screenshots.
 *
 *   node .claude/skills/run-pdf-reader/driver.mjs [--out <dir>] [--keep-data]
 *
 * Why CDP rather than Playwright's _electron: this app is developed on Windows,
 * where Playwright's Electron support is the least-travelled path. A raw CDP
 * WebSocket needs no extra dependency and gives real OS-level input events,
 * which is the only way to exercise text selection (see `drag`).
 *
 * Commands
 *   launch [pdf]        start the app, optionally opening a PDF via argv
 *   open <pdf>          hand a PDF to the running instance (single-instance path)
 *   state               compact dump of page / zoom / highlights / mode
 *   eval <js>           run JS in the renderer; body of an async fn, use `return`
 *   click <selector>    REAL mouse click at the element's centre
 *   clicktext <label>   REAL click on the button with this exact label
 *   drag <selector>     REAL press-drag-release across an element (selects text)
 *   type <text>         REAL character key events into the focused element
 *   key <combo>         e.g. Escape, Enter, F3, ctrl+f
 *   set <sel> <value>   set an input/range value (React-safe)
 *   ss [name]           screenshot into the out dir
 *   sleep <ms>          wait
 *   quit                stop the app and exit
 */
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import electronPath from 'electron'

const args = process.argv.slice(2)
const OUT = resolve(valueOf('--out') ?? 'driver-out')
const KEEP_DATA = args.includes('--keep-data')
// Accumulate a library across runs WITHOUT touching the real profile. Without
// this the throwaway profile is wiped on every launch, and reaching for
// --keep-data to keep documents around silently writes to the user's library.
const REUSE_DATA = args.includes('--reuse-data')
const PORT = Number(valueOf('--port') ?? 9333)

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (...a) => console.log(...a)

mkdirSync(OUT, { recursive: true })
// A throwaway profile, so driving the app never touches the real library in
// %APPDATA%\PDF Reader. --reuse-data keeps that throwaway profile between runs;
// --keep-data is the different, louder thing: drive the REAL library.
const userData = resolve(OUT, 'userdata')
if (!KEEP_DATA && !REUSE_DATA) rmSync(userData, { recursive: true, force: true })
if (KEEP_DATA) say('!! --keep-data: driving the REAL library, not a throwaway profile')

let child = null
let ws = null
let shots = 0

/** A leftover instance holds the single-instance lock and makes new launches
 *  exit silently with code 0 — the single most confusing failure here. */
function killStrays() {
  if (process.platform !== 'win32') return
  spawnSync('taskkill', ['/F', '/IM', 'PDF Reader.exe'], { stdio: 'ignore' })
  spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' })
}

function rpc(method, params = {}) {
  if (!ws) throw new Error('not launched — run `launch` first')
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

async function ev(expression) {
  const r = await rpc('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}

async function launch(pdf) {
  killStrays()
  await sleep(500)

  const argv = ['.', `--remote-debugging-port=${PORT}`]
  if (!KEEP_DATA) argv.push(`--user-data-dir=${userData}`)
  if (pdf) argv.push(resolve(pdf))

  child = spawn(electronPath, argv, {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => process.env.DRIVER_VERBOSE && process.stdout.write(`[app] ${d}`))
  child.stderr.on('data', (d) => process.env.DRIVER_VERBOSE && process.stdout.write(`[app] ${d}`))

  let target
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      /* not up yet */
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('app never exposed a debug port (build first? stray instance?)')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  await rpc('Page.enable')
  await rpc('Runtime.enable')

  // Wait for React to mount rather than guessing with a fixed sleep.
  for (let i = 0; i < 60; i++) {
    const ready = await ev(`return !!document.querySelector('.app, .library, .viewer');`).catch(() => false)
    if (ready) break
    await sleep(250)
  }
  if (pdf) await waitForPages()
  say('launched')
}

async function waitForPages() {
  for (let i = 0; i < 80; i++) {
    const n = await ev(`return document.querySelectorAll('.textLayer span').length;`)
    if (n > 0) return true
    await sleep(400)
  }
  say('warning: no text layer rendered after 32s')
  return false
}

async function boxOf(selector) {
  const box = await ev(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2,
             x0: r.left + 3, x1: r.right - 3, text: (el.textContent ?? '').slice(0, 60) };
  `)
  if (!box) throw new Error(`no element matches ${selector}`)
  return box
}

const mouse = (type, x, y) =>
  rpc('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1
  })

/** Most toolbar and sidebar buttons carry no class, so labels are the handle. */
async function clickText(label) {
  const at = await ev(`
    const b = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `)
  if (!at) throw new Error(`no button labelled ${JSON.stringify(label)}`)
  await mouse('mousePressed', at.x, at.y)
  await mouse('mouseReleased', at.x, at.y)
  await sleep(400)
  say(`clicked button "${label}"`)
}

async function realClick(selector) {
  const b = await boxOf(selector)
  await mouse('mousePressed', b.x, b.y)
  await mouse('mouseReleased', b.x, b.y)
  await sleep(400)
  say(`clicked ${selector}`)
}

/**
 * A real press-drag-release. Synthetic events and document.createRange() both
 * bypass the browser's hit-testing and its mousedown handlers, so only this path
 * reproduces what a user's selection actually does.
 */
async function realDrag(selector) {
  // pdf.js emits empty spacer spans between the real text runs, so take the
  // first match that actually has characters in it.
  const b = await ev(`
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els.find(e => (e.textContent ?? '').trim().length > 10) ?? els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Inside the glyph box, but only just: +3 lands past the midpoint of the
    // first character, so the selection silently dropped its opening letter.
    // Outside the box does not work at all — the press starts no selection.
    return { y: r.top + r.height / 2, x0: r.left + 1, x1: r.right - 1,
             text: (el.textContent ?? '').slice(0, 50) };
  `)
  if (!b) throw new Error(`no element matches ${selector}`)
  await mouse('mousePressed', b.x0, b.y)
  for (let i = 1; i <= 12; i++) {
    await mouse('mouseMoved', b.x0 + ((b.x1 - b.x0) * i) / 12, b.y)
    await sleep(20)
  }
  await mouse('mouseReleased', b.x1, b.y)
  await sleep(600)
  const sel = await ev(`return (window.getSelection()?.toString() ?? '').slice(0, 80);`)
  say(`dragged across ${selector} -> selected: ${JSON.stringify(sel)}`)
}

const KEYS = {
  Escape: { code: 'Escape', key: 'Escape', vk: 27 },
  Enter: { code: 'Enter', key: 'Enter', vk: 13 },
  Tab: { code: 'Tab', key: 'Tab', vk: 9 },
  F3: { code: 'F3', key: 'F3', vk: 114 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 }
}

async function pressKey(combo) {
  const parts = combo.split('+')
  const name = parts.pop()
  let modifiers = 0
  for (const m of parts) {
    if (m === 'alt') modifiers |= 1
    if (m === 'ctrl') modifiers |= 2
    if (m === 'meta') modifiers |= 4
    if (m === 'shift') modifiers |= 8
  }
  const k = KEYS[name] ?? {
    code: `Key${name.toUpperCase()}`,
    key: name,
    vk: name.toUpperCase().charCodeAt(0)
  }
  for (const type of ['rawKeyDown', 'keyUp']) {
    await rpc('Input.dispatchKeyEvent', {
      type,
      modifiers,
      code: k.code,
      key: k.key,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk
    })
  }
  await sleep(300)
  say(`pressed ${combo}`)
}

async function typeText(text) {
  for (const ch of text) await rpc('Input.dispatchKeyEvent', { type: 'char', text: ch })
  await sleep(300)
  say(`typed ${JSON.stringify(text)}`)
}

/**
 * Set a range/text input's value. React tracks the previous value on the DOM
 * node, so assigning `.value` directly is swallowed — the native setter has to be
 * called before dispatching the event, or the component never re-renders.
 */
async function setValue(rest) {
  const sp = rest.lastIndexOf(' ')
  const selector = rest.slice(0, sp).trim()
  const value = rest.slice(sp + 1).trim()
  const result = await ev(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  `)
  if (result === null) throw new Error(`no element matches ${selector}`)
  say(`set ${selector} = ${result}`)
}

async function screenshot(name) {
  const file = resolve(OUT, `${String(++shots).padStart(2, '0')}-${name ?? 'shot'}.png`)
  const { data } = await rpc('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(data, 'base64'))
  say(`screenshot -> ${file}`)
}

async function state() {
  const s = await ev(`
    const hl = window.api ? await window.api.annotations.listByDoc(1).catch(() => []) : [];
    return {
      view: document.querySelector('.viewer') ? 'reader' : 'library',
      docTitle: document.querySelector('.doc-title')?.textContent ?? null,
      page: document.querySelector('.page-input')?.value ?? null,
      totalPages: document.querySelectorAll('.page').length || null,
      zoom: [...document.querySelectorAll('.toolbar span')].map(s => s.textContent).find(t => /%/.test(t)) ?? null,
      mode: document.querySelector('.toolbar [data-act="reading-mode"]')?.textContent.trim() ?? null,
      libraryCards: document.querySelectorAll('.lib-card').length,
      highlightsDrawn: document.querySelectorAll('.highlight-layer .rect').length,
      sidebarItems: document.querySelectorAll('.ann-item').length,
      highlightsStored: hl.length
    };
  `)
  say(JSON.stringify(s, null, 2))
}

async function openInRunning(pdf) {
  // The single-instance lock routes a second launch's file into the live window
  // — but the lock is per user-data dir, so this MUST pass the same profile as
  // launch(). Without it the second instance missed the lock entirely and opened
  // a fresh window on the real library.
  const argv = ['.']
  if (!KEEP_DATA) argv.push(`--user-data-dir=${userData}`)
  argv.push(resolve(pdf))
  const p = spawn(electronPath, argv, { cwd: process.cwd(), stdio: 'ignore' })
  await sleep(4000)
  p.kill()
  await waitForPages()
  say(`opened ${pdf} in the running window`)
}

async function run(line) {
  const sp = line.indexOf(' ')
  const cmd = sp === -1 ? line : line.slice(0, sp)
  const rest = sp === -1 ? '' : line.slice(sp + 1).trim()

  switch (cmd) {
    case 'launch': return launch(rest || undefined)
    case 'open': return openInRunning(rest)
    case 'state': return state()
    case 'eval': return say(JSON.stringify(await ev(rest), null, 2))
    case 'click': return realClick(rest)
    case 'clicktext': return clickText(rest)
    case 'drag': return realDrag(rest)
    case 'type': return typeText(rest)
    case 'key': return pressKey(rest)
    case 'set': return setValue(rest)
    case 'ss': return screenshot(rest || undefined)
    case 'sleep': return sleep(Number(rest || 500))
    case 'quit': throw { quit: true }
    default: return say(`unknown command: ${cmd}`)
  }
}

const rl = createInterface({ input: process.stdin, terminal: false })
let queue = Promise.resolve()
let failed = false

rl.on('line', (raw) => {
  const line = raw.trim()
  if (!line || line.startsWith('#')) return
  queue = queue.then(async () => {
    if (failed) return
    say(`> ${line}`)
    try {
      await run(line)
    } catch (err) {
      if (err && err.quit) { rl.close(); return }
      failed = true
      say(`ERROR: ${err.message ?? err}`)
    }
  })
})

rl.on('close', () => {
  queue.then(async () => {
    try { ws?.close() } catch { /* ignore */ }
    try { child?.kill() } catch { /* ignore */ }
    await sleep(300)
    killStrays()
    process.exit(failed ? 1 : 0)
  })
})
