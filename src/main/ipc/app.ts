import { ipcMain, shell } from 'electron'
import { zExternalUrl } from './schemas'

export function registerAppHandlers(): void {
  ipcMain.handle('app:openExternal', async (_e, rawUrl: unknown) => {
    await shell.openExternal(zExternalUrl.parse(rawUrl))
  })
}
