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
});
