import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import { migrate } from './migrations'

let db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (db) return db
  // Never __dirname — in dev, main runs from out/main.
  const file = join(app.getPath('userData'), 'library.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
