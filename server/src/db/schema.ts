import Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id          TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email       TEXT NOT NULL,
      avatar_url  TEXT
    );

    CREATE TABLE IF NOT EXISTS issues (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL,
      assignee_id         TEXT REFERENCES team_members(id),
      talla               TEXT CHECK(talla IN ('S','M','L','XL')),
      talla_confidence    REAL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      synced_at           TEXT NOT NULL,
      last_transition_at  TEXT,
      talla_updated_at    TEXT,
      requester           TEXT,
      boards              TEXT,
      priority            TEXT
    );

    CREATE TABLE IF NOT EXISTS transitions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id         TEXT NOT NULL REFERENCES issues(id),
      from_status      TEXT NOT NULL,
      to_status        TEXT NOT NULL,
      transitioned_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transitions_issue ON transitions(issue_id);
    CREATE INDEX IF NOT EXISTS idx_transitions_at ON transitions(transitioned_at);
    CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);

    CREATE TABLE IF NOT EXISTS sync_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT,
      synced_count     INTEGER NOT NULL DEFAULT 0,
      classified_count INTEGER NOT NULL DEFAULT 0,
      error            TEXT
    );

    CREATE TABLE IF NOT EXISTS board_sync (
      board_id      INTEGER PRIMARY KEY,
      last_synced_at TEXT NOT NULL,
      name          TEXT
    );
  `);

  const issueCols = db.prepare(`PRAGMA table_info(issues)`).all() as { name: string }[];
  for (const [col, ddl] of [
    ['talla_updated_at', `ALTER TABLE issues ADD COLUMN talla_updated_at TEXT`],
    ['requester',        `ALTER TABLE issues ADD COLUMN requester TEXT`],
    ['boards',           `ALTER TABLE issues ADD COLUMN boards TEXT`],
    ['priority',         `ALTER TABLE issues ADD COLUMN priority TEXT`],
  ] as const) {
    if (!issueCols.some(c => c.name === col)) db.exec(ddl);
  }

  const boardCols = db.prepare(`PRAGMA table_info(board_sync)`).all() as { name: string }[];
  if (!boardCols.some(c => c.name === 'name')) {
    db.exec(`ALTER TABLE board_sync ADD COLUMN name TEXT`);
  }
}
