import type BetterSqlite3 from 'better-sqlite3'

/** Ordered list of migrations. Append only — never edit a shipped entry. */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE documents (
  id             INTEGER PRIMARY KEY,
  path           TEXT    NOT NULL,
  sha256         TEXT    NOT NULL,
  file_size      INTEGER NOT NULL,
  title          TEXT,
  author         TEXT,
  page_count     INTEGER NOT NULL DEFAULT 0,
  last_page      INTEGER NOT NULL DEFAULT 1,
  last_scroll    REAL,
  last_zoom      REAL,
  last_opened_at INTEGER,
  created_at     INTEGER NOT NULL,
  missing        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_documents_sha256 ON documents(sha256);
CREATE INDEX idx_documents_path   ON documents(path);
CREATE INDEX idx_documents_recent ON documents(last_opened_at DESC);

CREATE TABLE highlights (
  id          INTEGER PRIMARY KEY,
  doc_id      INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  color       TEXT    NOT NULL,
  rects       TEXT    NOT NULL,
  quoted_text TEXT    NOT NULL DEFAULT '',
  text_start  INTEGER,
  text_end    INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_highlights_doc_page ON highlights(doc_id, page);
CREATE INDEX idx_highlights_doc_time ON highlights(doc_id, created_at DESC);

CREATE TABLE notes (
  id           INTEGER PRIMARY KEY,
  doc_id       INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  highlight_id INTEGER REFERENCES highlights(id) ON DELETE CASCADE,
  page         INTEGER,
  anchor       TEXT,
  body         TEXT    NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_notes_highlight ON notes(highlight_id) WHERE highlight_id IS NOT NULL;
CREATE INDEX idx_notes_doc ON notes(doc_id, page);

CREATE TABLE page_text (
  doc_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page    INTEGER NOT NULL,
  text    TEXT    NOT NULL,
  offsets TEXT    NOT NULL,
  PRIMARY KEY (doc_id, page)
) WITHOUT ROWID;

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
  },
  {
    version: 2,
    // Its own table rather than a column on documents: every read in repos/documents
    // is SELECT *, so a BLOB there would be pulled into memory on every library list.
    sql: `
CREATE TABLE thumbnails (
  doc_id     INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  page       INTEGER NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  image      BLOB    NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
`
  }
]

export function migrate(db: BetterSqlite3.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  let current = row?.version ?? 0
  if (row === undefined) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('UPDATE schema_version SET version = ?').run(m.version)
    })()
    current = m.version
  }
}
