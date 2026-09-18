import { ipcMain } from 'electron'
import { z } from 'zod'
import * as highlights from '../db/repos/highlights'
import { zHighlightPatch, zId, zNewHighlight, zNewHighlightGroup } from './schemas'
import type { Highlight } from '../../shared/types'

const zNoteBody = z.string().max(200_000)

export function registerAnnotationHandlers(): void {
  ipcMain.handle('ann:listByDoc', (_e, rawId: unknown): Highlight[] =>
    highlights.listByDoc(zId.parse(rawId))
  )

  ipcMain.handle('ann:createHl', (_e, raw: unknown): Highlight =>
    highlights.create(zNewHighlight.parse(raw))
  )

  // One selection, one call: a cross-page drag lands as a single transaction
  // rather than N races, and every row it writes shares a group id.
  ipcMain.handle('ann:createGroup', (_e, raw: unknown): Highlight[] =>
    highlights.createGroup(zNewHighlightGroup.parse(raw))
  )

  // The three mutations below address a selection through any one of its rows
  // and return every row they touched — a cross-page highlight is recoloured,
  // annotated and deleted as one.
  ipcMain.handle('ann:updateHl', (_e, rawId: unknown, rawPatch: unknown): Highlight[] =>
    highlights.update(zId.parse(rawId), zHighlightPatch.parse(rawPatch))
  )

  ipcMain.handle('ann:deleteHl', (_e, rawId: unknown): number[] =>
    highlights.remove(zId.parse(rawId))
  )

  ipcMain.handle('ann:upsertNote', (_e, rawId: unknown, rawBody: unknown): Highlight[] =>
    highlights.upsertNote(zId.parse(rawId), zNoteBody.parse(rawBody))
  )
}
