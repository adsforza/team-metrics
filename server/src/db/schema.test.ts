import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from './schema';

describe('DB schema', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    applySchema(db);
  });

  it('creates issues table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='issues'`).get();
    expect(row).toBeTruthy();
  });

  it('creates transitions table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='transitions'`).get();
    expect(row).toBeTruthy();
  });

  it('creates team_members table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'`).get();
    expect(row).toBeTruthy();
  });

  it('creates sync_log table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_log'`).get();
    expect(row).toBeTruthy();
  });

  it('agrega las columnas de carga de trabajo sobre una base preexistente', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE issues (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, assignee_id TEXT, talla TEXT, talla_confidence REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT NOT NULL, last_transition_at TEXT);
      CREATE TABLE board_sync (board_id INTEGER PRIMARY KEY, last_synced_at TEXT NOT NULL);
      INSERT INTO issues VALUES ('OPS-1','t','','Backlog',NULL,'M',0.9,'2026-01-01','2026-01-01','2026-01-01',NULL);`);
    applySchema(db);
    const cols = (db.prepare(`PRAGMA table_info(issues)`).all() as any[]).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['requester', 'boards', 'priority']));
    const bcols = (db.prepare(`PRAGMA table_info(board_sync)`).all() as any[]).map(c => c.name);
    expect(bcols).toContain('name');
    // la migracion no puede tocar la talla existente
    expect((db.prepare(`SELECT talla FROM issues WHERE id='OPS-1'`).get() as any).talla).toBe('M');
  });
});
