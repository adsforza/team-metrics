import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getComparison } from './comparison';

// Week under test: Mon 2026-06-22 → Sun 2026-06-28
// Previous week:   Mon 2026-06-15 → Sun 2026-06-21
const NOW = new Date('2026-06-25T12:00:00Z');
const WEEK      = '2026-06-22';
const PREV_WEEK = '2026-06-15';

let db: Database.Database;

function seedTransition(issueId: string, fromStatus: string, toStatus: string, at: string) {
  db.prepare(`INSERT OR IGNORE INTO issues (id, title, description, status, assignee_id, talla, talla_confidence,
    created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(issueId, `Issue ${issueId}`, '', toStatus, null, 'M', 0.9,
        '2026-01-01T00:00:00Z', at, at, at, null);
  db.prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(toStatus, issueId);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(issueId, fromStatus, toStatus, at);
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('getComparison', () => {
  it('returns zero counts when no transitions exist', () => {
    const r = getComparison(db, { now: NOW });
    expect(r.week).toBe(WEEK);
    expect(r.prevWeek).toBe(PREV_WEEK);
    expect(r.throughput.current).toBe(0);
    expect(r.throughput.previous).toBe(0);
    expect(r.wip.current).toBe(0);
    expect(r.wip.previous).toBe(0);
  });

  it('throughput counts Done transitions only in the correct week window', () => {
    // Issue A: done in current week
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z');
    // Issue B: done in previous week
    seedTransition('B', 'In Progress', 'Finalizada', '2026-06-17T10:00:00Z');
    // Issue C: done after current week (should not count)
    seedTransition('C', 'In Progress', 'Done', '2026-07-01T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    expect(r.throughput.current).toBe(1);   // only A
    expect(r.throughput.previous).toBe(1);  // only B
    expect(r.throughput.delta).toBe(0);
  });

  it('wip snapshot excludes issues that are Done at end of week', () => {
    // Issue A: was In Progress before current week, became Done mid-week
    seedTransition('A', 'To Do', 'In Progress', '2026-06-18T10:00:00Z');
    seedTransition('A', 'In Progress', 'Done', '2026-06-25T10:00:00Z');
    // Issue B: started In Progress at start of current week, still active
    seedTransition('B', 'To Do', 'In Progress', '2026-06-22T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    // End of prev week (before 2026-06-22T00:00:00Z): A was In Progress, B not started → wip.previous=1
    expect(r.wip.previous).toBe(1);
    // End of current week (before 2026-06-29T00:00:00Z): A is Done, B still In Progress → wip.current=1
    expect(r.wip.current).toBe(1);
  });

  it('deltaPct is null when previous is 0', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    expect(r.throughput.current).toBe(1);
    expect(r.throughput.previous).toBe(0);
    expect(r.throughput.deltaPct).toBeNull();
  });

  it('opts.week selects a past week correctly', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-17T10:00:00Z'); // in prev week (2026-06-15)

    const r = getComparison(db, { week: PREV_WEEK, now: NOW });
    expect(r.week).toBe(PREV_WEEK);
    expect(r.throughput.current).toBe(1);
  });

  it('opts.assignee restricts throughput and wip to that member', () => {
    db.prepare(`INSERT INTO team_members VALUES (?,?,?,null)`).run('u1', 'Ana', 'u1@t.com');
    db.prepare(`INSERT INTO team_members VALUES (?,?,?,null)`).run('u2', 'Beto', 'u2@t.com');
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z'); // done this week
    seedTransition('B', 'To Do', 'In Progress', '2026-06-23T10:00:00Z'); // active this week
    seedTransition('C', 'In Progress', 'Done', '2026-06-24T10:00:00Z'); // done this week (other person)
    seedTransition('D', 'To Do', 'In Progress', '2026-06-23T10:00:00Z'); // active this week (other person)
    db.prepare(`UPDATE issues SET assignee_id = 'u1' WHERE id IN ('A','B')`).run();
    db.prepare(`UPDATE issues SET assignee_id = 'u2' WHERE id IN ('C','D')`).run();

    const all = getComparison(db, { now: NOW });
    expect(all.throughput.current).toBe(2); // A + C
    expect(all.wip.current).toBe(2);        // B + D

    const u1 = getComparison(db, { now: NOW, assignee: 'u1' });
    expect(u1.throughput.current).toBe(1);  // only A
    expect(u1.wip.current).toBe(1);         // only B
  });
});
