import { ipcMain } from 'electron'
import { z } from 'zod'
import * as highlights from '../db/repos/highlights'
import { zHighlightPatch, zId, zNewHighlight } from './schemas'
import type { Highlight } from '../../shared/types'

const zNoteBody = z.string().max(200_000)

export function registerAnnotationHandlers(): void {
  ipcMain.handle('ann:listByDoc', (_e, rawId: unknown): Highlight[] =>
    highlights.listByDoc(zId.parse(rawId))
  )

  ipcMain.handle('ann:createHl', (_e, raw: unknown): Highlight =>
    highlights.create(zNewHighlight.parse(raw))
  )

  ipcMain.handle('ann:updateHl', (_e, rawId: unknown, rawPatch: unknown): Highlight | null =>
    highlights.update(zId.parse(rawId), zHighlightPatch.parse(rawPatch))
  )

  ipcMain.handle('ann:deleteHl', (_e, rawId: unknown): void => {
    highlights.remove(zId.parse(rawId))
  })

  ipcMain.handle('ann:upsertNote', (_e, rawId: unknown, rawBody: unknown): Highlight | null =>
    highlights.upsertNote(zId.parse(rawId), zNoteBody.parse(rawBody))
  )
}
