import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getBottleneck } from './bottleneck';

const NOW = new Date('2026-06-27T12:00:00Z');

let db: Database.Database;

// Insert a non-done issue currently in `status`, which entered it at `enteredAt`
function seedCurrent(id: string, status: string, enteredAt: string, talla: string | null = 'M') {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Issue ${id}`, '', status, 'u1', talla, 0.9,
        '2026-01-01T00:00:00Z', enteredAt, '2026-06-27T00:00:00Z', enteredAt, null);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', status, enteredAt);
}

// Insert a done issue that passed through `status` between enteredAt and exitedAt (completed pass)
function seedPass(id: string, status: string, enteredAt: string, exitedAt: string, talla: string = 'M') {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Done ${id}`, '', 'Done', 'u1', talla, 0.9,
        '2026-01-01T00:00:00Z', exitedAt, '2026-06-27T00:00:00Z', exitedAt, null);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', status, enteredAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, status, 'Done', exitedAt);
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(`INSERT INTO team_members VALUES ('u1','Test','t@t.com',null)`).run();
});

describe('getBottleneck', () => {
  it('returns empty states when db has no active issues', () => {
    const r = getBottleneck(db, { now: NOW });
    expect(r.lookbackWeeks).toBe(8);
    expect(r.total_active).toBe(0);
    expect(r.states).toEqual([]);
  });

  it('assigns crítico to the state with highest combined queue and avg_days', () => {
    // "In Progress": 10 current + 5 passes of ~8d
    for (let i = 0; i < 10; i++) {
      seedCurrent(`ip-c${i}`, 'In Progress', '2026-06-20T00:00:00Z');
    }
    seedPass('ip-p0', 'In Progress', '2026-06-01T00:00:00Z', '2026-06-09T00:00:00Z'); // 8d
    seedPass('ip-p1', 'In Progress', '2026-06-03T00:00:00Z', '2026-06-11T00:00:00Z'); // 8d
    seedPass('ip-p2', 'In Progress', '2026-06-05T00:00:00Z', '2026-06-13T00:00:00Z'); // 8d
    seedPass('ip-p3', 'In Progress', '2026-06-07T00:00:00Z', '2026-06-15T00:00:00Z'); // 8d
    seedPass('ip-p4', 'In Progress', '2026-06-09T00:00:00Z', '2026-06-17T00:00:00Z'); // 8d

    // "To Do": 2 current + 5 passes of ~1d
    for (let i = 0; i < 2; i++) {
      seedCurrent(`td-c${i}`, 'To Do', '2026-06-25T00:00:00Z');
    }
    seedPass('td-p0', 'To Do', '2026-06-15T00:00:00Z', '2026-06-16T00:00:00Z'); // 1d
    seedPass('td-p1', 'To Do', '2026-06-16T00:00:00Z', '2026-06-17T00:00:00Z');
    seedPass('td-p2', 'To Do', '2026-06-17T00:00:00Z', '2026-06-18T00:00:00Z');
    seedPass('td-p3', 'To Do', '2026-06-18T00:00:00Z', '2026-06-19T00:00:00Z');
    seedPass('td-p4', 'To Do', '2026-06-19T00:00:00Z', '2026-06-20T00:00:00Z');

    const r = getBottleneck(db, { now: NOW });
    const ip = r.states.find(s => s.status === 'In Progress')!;
    const td = r.states.find(s => s.status === 'To Do')!;

    expect(ip).toBeDefined();
    expect(ip.score).toBe('crítico');
    expect(ip.avg_days).toBeCloseTo(8, 0);
    expect(td).toBeDefined();
    expect(td.score).not.toBe('crítico');
    // states sorted severity desc: In Progress first
    expect(r.states[0].status).toBe('In Progress');
  });

  it('sets avg_days to null when state has fewer than 3 completed passes', () => {
    seedCurrent('b1', 'Blocked', '2026-06-20T00:00:00Z');
    // Only 2 passes — below MIN_SAMPLES_FOR_AVG
    seedPass('bp0', 'Blocked', '2026-06-10T00:00:00Z', '2026-06-14T00:00:00Z'); // 4d
    seedPass('bp1', 'Blocked', '2026-06-14T00:00:00Z', '2026-06-17T00:00:00Z'); // 3d

    const r = getBottleneck(db, { now: NOW });
    const blocked = r.states.find(s => s.status === 'Blocked')!;
    expect(blocked.avg_days).toBeNull();
    expect(blocked.detail.p85_days).toBeNull();
  });

  it('orders top_issues by days_in_state descending and caps at 8', () => {
    // 10 issues in "In Review" with different entry times
    for (let i = 0; i < 10; i++) {
      // i=0 entered 20 days ago, i=9 entered 2 days ago
      const daysAgo = 20 - i * 2;
      const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
      seedCurrent(`ir-${i}`, 'In Review', d.toISOString());
    }

    const r = getBottleneck(db, { now: NOW });
    const ir = r.states.find(s => s.status === 'In Review')!;
    expect(ir.detail.top_issues.length).toBe(8);
    // First issue has most days_in_state
    expect(ir.detail.top_issues[0].days_in_state).toBeGreaterThan(
      ir.detail.top_issues[1].days_in_state,
    );
  });

  it('builds trend with correct ISO-Monday week labels', () => {
    // Seed current issue so state is included
    seedCurrent('ip-now', 'In Progress', '2026-06-25T00:00:00Z');
    // Three passes in different weeks (dates are Mondays of their respective weeks)
    // 2026-06-08 is a Monday (verified: Jun 1 is Mon, +7 = Jun 8)
    seedPass('tp0', 'In Progress', '2026-06-08T00:00:00Z', '2026-06-10T00:00:00Z'); // 2d, week=2026-06-08
    seedPass('tp1', 'In Progress', '2026-06-15T00:00:00Z', '2026-06-19T00:00:00Z'); // 4d, week=2026-06-15
    seedPass('tp2', 'In Progress', '2026-06-22T00:00:00Z', '2026-06-25T00:00:00Z'); // 3d, week=2026-06-22

    const r = getBottleneck(db, { now: NOW });
    const ip = r.states.find(s => s.status === 'In Progress')!;
    const { trend } = ip.detail;

    expect(trend.length).toBe(3);
    expect(trend[0].week).toBe('2026-06-08');
    expect(trend[1].week).toBe('2026-06-15');
    expect(trend[2].week).toBe('2026-06-22');
    expect(trend[0].avg_days).toBeCloseTo(2, 5);
    expect(trend[1].avg_days).toBeCloseTo(4, 5);
    expect(trend[2].avg_days).toBeCloseTo(3, 5);
  });

  it('computes pct_of_wip as queue_size / total_active', () => {
    seedCurrent('ip1', 'In Progress', '2026-06-20T00:00:00Z');
    seedCurrent('ip2', 'In Progress', '2026-06-21T00:00:00Z');
    seedCurrent('td1', 'To Do', '2026-06-25T00:00:00Z');
    // total_active = 3

    const r = getBottleneck(db, { now: NOW });
    expect(r.total_active).toBe(3);
    const ip = r.states.find(s => s.status === 'In Progress')!;
    expect(ip.detail.pct_of_wip).toBeCloseTo(2 / 3, 5);
    const td = r.states.find(s => s.status === 'To Do')!;
    expect(td.detail.pct_of_wip).toBeCloseTo(1 / 3, 5);
  });
});
