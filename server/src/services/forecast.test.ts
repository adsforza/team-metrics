import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { dailyThroughput } from './forecast';

function seedDone(db: Database.Database, id: string, doneAt: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `I ${id}`, '', 'Done', null, 'M', 0.9, '2026-01-01T00:00:00Z', doneAt, '2026-06-25T00:00:00Z', doneAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'In Progress', 'Done', doneAt);
}

describe('dailyThroughput', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applySchema(db); });

  it('buckets completions into the correct day within the lookback window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    seedDone(db, 'A-1', '2026-06-24T10:00:00Z');
    seedDone(db, 'A-2', '2026-06-24T20:00:00-0300');
    seedDone(db, 'A-3', '2026-06-25T09:00:00Z');
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily).toHaveLength(84);
    expect(daily[83]).toBe(1); // today (2026-06-25)
    expect(daily[82]).toBe(2); // yesterday (2026-06-24)
    expect(daily.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('ignores completions outside the window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    seedDone(db, 'OLD', '2026-01-01T10:00:00Z');
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
