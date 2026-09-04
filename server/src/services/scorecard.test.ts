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
  db.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence,
    created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `Issue ${id}`, '', lastStatus, assignee, talla, 0.9, created, lastAt, '2026-06-20T00:00:00Z', lastAt, null,
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

  it('excludes a member that lacks data for all four indicators', () => {
    // Only 1 completed issue → predictability is null → member is incomplete → dropped entirely.
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members).toHaveLength(0);
  });

  it('excludes incomplete members from the table and from the team aggregate', () => {
    seedMember(db, 'u2', 'Beto');
    // u1 is complete: 2 completed M issues (delivery 4) with distinct cycle times.
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    // u2 is incomplete: a single completed XL issue (delivery 8) → predictability null.
    seedIssue(db, 'B-1', 'u2', 'XL', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members).toHaveLength(1);
    expect(sc.members[0].member.id).toBe('u1');
    // Team aggregate must NOT include u2's XL (8): only u1's two M (4) count.
    expect(sc.team.delivery.value).toBe(4);
  });

  it('computes flow efficiency from active vs. blocked time', () => {
    // Two completed issues (so the member is included), each: In Progress 1 day, Blocked 1 day,
    // then Done → active ratio 0.5 → median flow 50%.
    for (const id of ['A-1', 'A-2']) {
      seedIssue(db, id, 'u1', 'M', '2026-06-08T00:00:00Z', [
        ['In Progress', '2026-06-09T00:00:00Z'],
        ['Blocked', '2026-06-10T00:00:00Z'],
        ['Done', '2026-06-11T00:00:00Z'],
      ]);
    }
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).toBeCloseTo(50, 1);
  });

  it('builds team-median context across members', () => {
    seedMember(db, 'u2', 'Beto');
    // u1 complete: two M (delivery 4). u2 complete: one L + one XL (delivery 12).
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    seedIssue(db, 'B-1', 'u2', 'L', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'B-2', 'u2', 'XL', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    const sc = getTeamScorecard(db, params);
    expect(sc.context.delivery.min).toBe(4);
    expect(sc.context.delivery.max).toBe(12);
    expect(sc.context.delivery.median).toBe(8);
  });

  it('parses Jira timestamps with -0300 offset (no colon) without producing NaN', () => {
    // Two completed issues so the member is included; both use the -0300 (no-colon) offset.
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00-0300', [
      ['In Progress', '2026-06-09T09:00:00-0300'],
      ['Done', '2026-06-10T09:00:00-0300'],
    ]);
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00-0300', [
      ['In Progress', '2026-06-09T09:00:00-0300'],
      ['Done', '2026-06-11T09:00:00-0300'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).not.toBeNull();
    expect(Number.isNaN(sc.members[0].flow.value as number)).toBe(false);
  });

  it('respects the talla filter for delivery', () => {
    // Two M (weight 2 each) plus one L (weight 4), all completed in the window. With talla='M'
    // only the two M issues count → delivery 4, and the member stays included (>= 2 completed M).
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    seedIssue(db, 'A-3', 'u1', 'L', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    const sc = getTeamScorecard(db, { from: '2026-06-08', to: '2026-06-14', talla: 'M' });
    expect(sc.members[0].delivery.value).toBe(4);   // L (4) excluded by the talla filter
    expect(sc.team.delivery.value).toBe(4);
  });

  it('reports regressions and blocked as a percentage of completed issues', () => {
    // A-1 regressed (Prioritized → back to In Progress) and passed through Blocked.
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T09:00:00Z'],
      ['Prioritized', '2026-06-10T09:00:00Z'],  // rank 3 (committed stage)
      ['In Progress', '2026-06-11T09:00:00Z'],  // rank 2 → backward from >= 3 → regression
      ['Blocked',     '2026-06-12T09:00:00Z'],
      ['Done',        '2026-06-13T09:00:00Z'],
    ]);
    // A-2 is clean: straight through, never blocked, never backwards.
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T09:00:00Z'],
      ['Done',        '2026-06-11T09:00:00Z'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].regressions.value).toBe(50); // 1 of 2 regressed
    expect(sc.members[0].blocked.value).toBe(50);     // 1 of 2 blocked
    // lower is better for both, so the null-previous case is steady.
    expect(sc.members[0].regressions.improving).toBe('steady');
  });

  it('ignores early-stage churn and Blocked when detecting regressions', () => {
    // A-1 goes backwards only below the committed stage (In Progress → To Do) and is blocked;
    // neither should register as a regression.
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T09:00:00Z'],  // rank 2
      ['To Do',       '2026-06-10T09:00:00Z'],  // rank 1, but prev rank 2 < 3 → not a regression
      ['In Progress', '2026-06-11T09:00:00Z'],
      ['Blocked',     '2026-06-12T09:00:00Z'],  // skipped by regression detection
      ['Done',        '2026-06-13T09:00:00Z'],
    ]);
    seedIssue(db, 'A-2', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T09:00:00Z'],
      ['Done',        '2026-06-11T09:00:00Z'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].regressions.value).toBe(0);  // early churn is not a regression
    expect(sc.members[0].blocked.value).toBe(50);     // A-1 still counts as blocked
  });

  it('adds regressions/blocked to the team context band', () => {
    const sc = getTeamScorecard(db, params);
    // Even with no data the context keys exist (zeroed), so the client can render six columns.
    expect(sc.context.regressions).toEqual({ min: 0, median: 0, max: 0 });
    expect(sc.context.blocked).toEqual({ min: 0, median: 0, max: 0 });
  });
});
