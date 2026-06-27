// server/src/services/wipRisk.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getWipRisk } from './wipRisk';

const NOW = new Date('2026-06-26T12:00:00Z');

// A completed issue: enters In Progress at `startAt`, reaches Done at `doneAt`.
function seedCompleted(db: Database.Database, id: string, talla: string, startAt: string, doneAt: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `Done ${id}`, '', 'Done', null, talla, 0.9, '2026-01-01T00:00:00Z', doneAt, '2026-06-26T00:00:00Z', doneAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', 'In Progress', startAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'In Progress', 'Done', doneAt);
}

// An in-progress issue: enters In Progress at `startAt`, optional extra transitions, not Done.
function seedActive(db: Database.Database, id: string, talla: string | null, status: string, startAt: string, extra: [string, string][] = []) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `WIP ${id}`, '', status, 'u1', talla, 0.9, '2026-06-01T00:00:00Z', startAt, '2026-06-26T00:00:00Z', startAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', 'In Progress', startAt);
  for (const [to, at] of extra) {
    db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
      .run(id, 'In Progress', to, at);
  }
}

// Seed 5 completed of `talla`, each with a cycle time of `cycleDays` days (within the window).
function seedFiveCompleted(db: Database.Database, talla: string, cycleDays: number, idPrefix: string) {
  for (let i = 0; i < 5; i++) {
    const start = `2026-06-1${i}T00:00:00Z`;
    const done = new Date(new Date(start).getTime() + cycleDays * 86400000).toISOString();
    seedCompleted(db, `${idPrefix}-${i}`, talla, start, done);
  }
}

describe('getWipRisk', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    db.prepare(`INSERT INTO team_members VALUES ('u1','Test User','test@test.com',null)`).run();
  });

  it('derives the p85 limit and sample_count per talla', () => {
    // 5 M completed, all 4-day cycle → p85 = 4
    seedFiveCompleted(db, 'M', 4, 'M');
    const r = getWipRisk(db, { now: NOW });
    const m = r.limits.find(l => l.talla === 'M')!;
    expect(m.sample_count).toBe(5);
    expect(m.limit_days).toBeCloseTo(4, 5);
    const s = r.limits.find(l => l.talla === 'S')!;
    expect(s.limit_days).toBeNull();        // no S data
    expect(s.sample_count).toBe(0);
  });

  it('nulls the limit and counts sin_limite when under MIN_SAMPLES', () => {
    seedCompleted(db, 'S-a', 'S', '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z'); // 1 only
    seedActive(db, 'WIP-S', 'S', 'In Progress', '2026-06-01T00:00:00Z');           // started, not done
    const r = getWipRisk(db, { now: NOW });
    expect(r.limits.find(l => l.talla === 'S')!.limit_days).toBeNull();
    expect(r.items.find(i => i.issue_id === 'WIP-S')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('classifies excedido / en_riesgo / hidden by ratio', () => {
    seedFiveCompleted(db, 'L', 10, 'L');                                  // limit_L = 10
    seedActive(db, 'WIP-over', 'L', 'In Progress', '2026-06-14T12:00:00Z'); // 12 days → ratio 1.2
    seedActive(db, 'WIP-risk', 'L', 'In Progress', '2026-06-18T12:00:00Z'); // 8 days  → ratio 0.8
    seedActive(db, 'WIP-ok', 'L', 'In Progress', '2026-06-21T12:00:00Z');   // 5 days  → ratio 0.5
    const r = getWipRisk(db, { now: NOW });
    const over = r.items.find(i => i.issue_id === 'WIP-over')!;
    const risk = r.items.find(i => i.issue_id === 'WIP-risk')!;
    expect(over.level).toBe('excedido');
    expect(risk.level).toBe('en_riesgo');
    expect(r.items.find(i => i.issue_id === 'WIP-ok')).toBeUndefined();
    expect(r.counts).toMatchObject({ en_riesgo: 1, excedido: 1 });
  });

  it('measures age from the first active entry even if currently blocked', () => {
    seedFiveCompleted(db, 'M', 2, 'M');                                   // limit_M = 2
    // Entered active 6 days ago, blocked 1 day ago, not done → age 6, ratio 3.0
    seedActive(db, 'WIP-b', 'M', 'Blocked', '2026-06-20T12:00:00Z', [['Blocked', '2026-06-25T12:00:00Z']]);
    const r = getWipRisk(db, { now: NOW });
    const it = r.items.find(i => i.issue_id === 'WIP-b')!;
    expect(it.age_days).toBeCloseTo(6, 1);
    expect(it.level).toBe('excedido');
  });

  it('counts issues without a talla as sin_limite', () => {
    seedFiveCompleted(db, 'M', 4, 'M');
    seedActive(db, 'WIP-notalla', null, 'In Progress', '2026-06-01T00:00:00Z');
    const r = getWipRisk(db, { now: NOW });
    expect(r.items.find(i => i.issue_id === 'WIP-notalla')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('sorts items by ratio descending', () => {
    seedFiveCompleted(db, 'L', 10, 'L');
    seedActive(db, 'WIP-a', 'L', 'In Progress', '2026-06-15T12:00:00Z'); // 11 days → 1.1
    seedActive(db, 'WIP-b', 'L', 'In Progress', '2026-06-10T12:00:00Z'); // 16 days → 1.6
    const r = getWipRisk(db, { now: NOW });
    expect(r.items.map(i => i.issue_id)).toEqual(['WIP-b', 'WIP-a']);
  });

  it('handles Jira -0300 timestamps without NaN', () => {
    seedFiveCompleted(db, 'M', 4, 'M');
    seedActive(db, 'WIP-tz', 'M', 'In Progress', '2026-06-20T12:00:00-0300'); // age ~6 days
    const r = getWipRisk(db, { now: NOW });
    const it = r.items.find(i => i.issue_id === 'WIP-tz')!;
    expect(Number.isNaN(it.age_days)).toBe(false);
    expect(it.age_days).toBeGreaterThan(0);
  });
});
