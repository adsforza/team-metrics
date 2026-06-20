// server/src/services/scorecard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getTeamScorecard, makeDimension, resolveWindows } from './scorecard';

function seedMember(db: Database.Database, id: string, name: string) {
  db.prepare(`INSERT INTO team_members VALUES (?,?,?,null)`).run(id, name, `${id}@t.com`);
}

// Insert an issue plus its transitions. `transitions` = [to_status, ISO timestamp] pairs.
function seedIssue(
  db: Database.Database,
  id: string, assignee: string, talla: string | null, created: string,
  transitions: [string, string][],
) {
  const lastStatus = transitions.length ? transitions[transitions.length - 1][0] : 'To Do';
  const lastAt = transitions.length ? transitions[transitions.length - 1][1] : created;
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `Issue ${id}`, '', lastStatus, assignee, talla, 0.9, created, lastAt, '2026-06-20T00:00:00Z', lastAt,
  );
  for (const [to, at] of transitions) {
    db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
      .run(id, 'X', to, at);
  }
}

describe('makeDimension', () => {
  it('flags improvement vs. worsening with correct polarity', () => {
    // delivery: higher is better
    expect(makeDimension(14, 10, false)).toMatchObject({ trend: 'up', improving: 'better' });
    // focus: lower is better, so an increase is "worse"
    expect(makeDimension(4, 2, true)).toMatchObject({ trend: 'up', improving: 'worse' });
    // predictability: lower is better, a decrease is "better"
    expect(makeDimension(1.4, 2.0, true)).toMatchObject({ trend: 'down', improving: 'better' });
  });

  it('treats small relative changes as flat/steady', () => {
    expect(makeDimension(101, 100, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });

  it('is steady when there is no previous value', () => {
    expect(makeDimension(10, null, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });

  it('handles a zero baseline', () => {
    expect(makeDimension(5, 0, false)).toMatchObject({ trend: 'up', improving: 'better' });
    expect(makeDimension(0, 0, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });
});

describe('resolveWindows', () => {
  it('builds an equal-length preceding window', () => {
    const { cur, prev } = resolveWindows({ from: '2026-06-08', to: '2026-06-14' }); // 7 days
    expect(cur).toEqual({ from: '2026-06-08', to: '2026-06-14' });
    expect(prev).toEqual({ from: '2026-06-01', to: '2026-06-07' });
  });
});

describe('getTeamScorecard', () => {
  let db: Database.Database;
  // current window: 2026-06-08..2026-06-14 ; previous: 2026-06-01..2026-06-07
  const params = { from: '2026-06-08', to: '2026-06-14' };

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    seedMember(db, 'u1', 'Ana');
  });

  it('weights delivery by talla over completed issues in the window', () => {
    // Two issues done in current window: one M (=2), one L (=4) → delivery 6
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'A-2', 'u1', 'L', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].delivery.value).toBe(6);
    expect(sc.team.delivery.value).toBe(6);
  });

  it('returns null predictability/flow with insufficient data', () => {
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    const sc = getTeamScorecard(db, params); // only 1 completed issue
    expect(sc.members[0].predictability.value).toBeNull();
    expect(sc.members[0].flow.value).not.toBeNull(); // flow needs only 1 issue
  });

  it('computes flow efficiency from active vs. blocked time', () => {
    // In Progress for 1 day, Blocked for 1 day, then Done → active ratio = 0.5 → 50%
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T00:00:00Z'],
      ['Blocked', '2026-06-10T00:00:00Z'],
      ['Done', '2026-06-11T00:00:00Z'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).toBeCloseTo(50, 1);
  });

  it('builds team-median context across members', () => {
    seedMember(db, 'u2', 'Beto');
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]); // delivery 2
    seedIssue(db, 'B-1', 'u2', 'XL', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]); // delivery 8
    const sc = getTeamScorecard(db, params);
    expect(sc.context.delivery.min).toBe(2);
    expect(sc.context.delivery.max).toBe(8);
    expect(sc.context.delivery.median).toBe(5);
  });

  it('parses Jira timestamps with -0300 offset (no colon) without producing NaN', () => {
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00-0300', [
      ['In Progress', '2026-06-09T09:00:00-0300'],
      ['Done', '2026-06-11T09:00:00-0300'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).not.toBeNull();
    expect(Number.isNaN(sc.members[0].flow.value as number)).toBe(false);
  });
});
