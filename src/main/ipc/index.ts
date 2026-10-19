import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { registerAppHandlers } from './app'
import { registerLibraryHandlers } from './library'
import { registerDocHandlers } from './doc'
import { registerAnnotationHandlers } from './annotations'
import { registerSettingsHandlers } from './settings'
import { registerTransferHandlers } from './transfer'

export function registerAllHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.removeHandler('__noop')
  registerLibraryHandlers(getWindow)
  registerDocHandlers(getWindow)
  registerAnnotationHandlers()
  registerSettingsHandlers()
  registerTransferHandlers(getWindow)
  registerAppHandlers()
}
