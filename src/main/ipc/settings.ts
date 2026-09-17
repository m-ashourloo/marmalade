import { ipcMain, nativeTheme } from 'electron'
import * as settings from '../db/repos/settings'
import { zSettingsKey } from './schemas'
import { DEFAULT_READING_PREFS } from '../../shared/types'
import type { ReadingPrefs } from '../../shared/types'

const READING_KEY = 'reading'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getReading', (): ReadingPrefs => {
    return { ...DEFAULT_READING_PREFS, ...settings.get<Partial<ReadingPrefs>>(READING_KEY, {}) }
  })

  ipcMain.handle('settings:setReading', (_e, raw: unknown) => {
    const prefs = raw as ReadingPrefs
    settings.set(READING_KEY, prefs)
    nativeTheme.themeSource = prefs.uiTheme === 'dark' ? 'dark' : 'light'
  })

  ipcMain.handle('settings:get', (_e, rawKey: unknown) => settings.get(zSettingsKey.parse(rawKey), null))
  ipcMain.handle('settings:set', (_e, rawKey: unknown, value: unknown) =>
    settings.set(zSettingsKey.parse(rawKey), value)
  )
}
