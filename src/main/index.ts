import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { registerAllHandlers } from './ipc'
import { closeDb, getDb } from './db/connection'
import * as settings from './db/repos/settings'
import { DEFAULT_READING_PREFS } from '../shared/types'
import type { ReadingPrefs } from '../shared/types'

let mainWindow: BrowserWindow | null = null
/** A .pdf passed on the command line before the window was ready. */
let pendingFile: string | null = null

/**
 * Electron injects its own flags at arbitrary argv positions, and argv[1] is the
 * app path in dev but the first real argument when packaged — so scan rather than
 * index. See electron/electron#32933 and #20322.
 */
function pdfFromArgv(argv: string[]): string | null {
  return argv.find((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.pdf')) ?? null
}

function sendOpenFile(path: string): void {
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:openFile', path)
  } else {
    pendingFile = path
  }
}

/**
 * The user-data folder is named after the product, so every rename strands the
 * previous directory. Earlier builds shipped as the npm package name
 * ('pdf-reader', pre-1.0) and then as 'PDF Reader' (1.0.0, before the app was
 * renamed to Marmalade). Move the first one we find across once, newest first,
 * so nobody loses their highlights on upgrade.
 */
const LEGACY_USER_DATA_DIRS = ['PDF Reader', 'pdf-reader']

function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  if (existsSync(join(current, 'library.db'))) return

  for (const name of LEGACY_USER_DATA_DIRS) {
    const legacy = join(dirname(current), name)
    if (legacy === current || !existsSync(join(legacy, 'library.db'))) continue

    try {
      mkdirSync(current, { recursive: true })
      for (const file of ['library.db', 'library.db-wal', 'library.db-shm']) {
        const from = join(legacy, file)
        if (existsSync(from)) cpSync(from, join(current, file))
      }
      console.log(`Migrated annotations from ${legacy} to ${current}`)
    } catch (err) {
      console.error('Could not migrate the previous library', err)
    }
    return
  }
}

function applyCsp(): void {
  // Dev needs a relaxed policy for the HMR websocket and inline module preamble.
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "worker-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 700,
    minHeight: 500,
    show: false,
    backgroundColor: '#1b1c1f',
    autoHideMenuBar: true,
    title: 'Marmalade',
    // On Windows the packaged .exe already carries the icon, but an unpackaged
    // run and every Linux window manager fall back to the default Electron logo
    // unless the window is given one explicitly. Copied next to this bundle by
    // the copy-app-icon plugin in electron.vite.config.ts.
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      // pdf.js drives its own rasterisation loop with requestAnimationFrame, and
      // Chromium stops rAF entirely for occluded windows. Without this, a page
      // that begins rendering as the user switches away never finishes, and the
      // viewer is frozen when they switch back.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (pendingFile) {
      mainWindow?.webContents.send('app:openFile', pendingFile)
      pendingFile = null
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Anything that wants a new window goes to the real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation away from the app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const file = pdfFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (file) sendOpenFile(file)
  })

  // macOS only; harmless on Windows.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    sendOpenFile(path)
  })

  app.whenReady().then(() => {
    migrateLegacyUserData()
    getDb()
    const prefs = {
      ...DEFAULT_READING_PREFS,
      ...settings.get<Partial<ReadingPrefs>>('reading', {})
    }
    nativeTheme.themeSource = prefs.uiTheme === 'dark' ? 'dark' : 'light'

    applyCsp()
    registerAllHandlers(() => mainWindow)

    pendingFile = pdfFromArgv(process.argv)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', closeDb)
}
