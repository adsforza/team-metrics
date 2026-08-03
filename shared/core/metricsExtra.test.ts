// Port of the relevant cases from server/src/services/metrics.test.ts (getThroughputWeekly,
// getCFD, getAgingWIP, getCycleTimeByTalla) onto in-memory CoreIssue/CoreTransition arrays.
import { describe, it, expect } from 'vitest';
import { computeThroughputWeekly, computeCFD, computeAgingWIP, computeCycleTimeByTalla } from './metricsExtra';
import type { CoreIssue, CoreTransition, CoreIssueWithTitle } from './types';

function issue(id: string, over: Partial<CoreIssue> = {}): CoreIssue {
  return {
    id, status: 'To Do', assignee_id: 'u1', talla: null,
    created_at: '2026-05-01T00:00:00Z', last_transition_at: null,
    ...over,
  };
}

function withTitle(i: CoreIssue, title: string): CoreIssueWithTitle {
  return { ...i, title };
}

describe('computeCycleTimeByTalla', () => {
  it('returns ct_p50 per talla, count, and team_ct_p50 (parity w/ metrics.test.ts)', () => {
    const issues: CoreIssue[] = [
      issue('OPS-1', { status: 'Done', assignee_id: 'u1', talla: 'M', last_transition_at: '2026-05-04T00:00:00Z' }),
      issue('OPS-2', { status: 'Done', assignee_id: 'u2', talla: 'L', last_transition_at: '2026-05-08T00:00:00Z' }),
      issue('OPS-3', { status: 'In Progress', assignee_id: 'u1', talla: 'S', created_at: '2026-05-20T00:00:00Z' }),
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'OPS-1', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-05-01T00:00:00Z' },
      { issue_id: 'OPS-1', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-04T00:00:00Z' },
      { issue_id: 'OPS-2', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-05-01T00:00:00Z' },
      { issue_id: 'OPS-2', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-08T00:00:00Z' },
      { issue_id: 'OPS-3', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-05-20T00:00:00Z' },
    ];

    const result = computeCycleTimeByTalla(issues, transitions, { from: '2026-05-01', to: '2026-05-31' });
    const m = result.find(r => r.talla === 'M');
    const l = result.find(r => r.talla === 'L');
    const s = result.find(r => r.talla === 'S');

    expect(m?.ct_p50).toBeCloseTo(3, 0);
    expect(m?.count).toBe(1);
    expect(l?.ct_p50).toBeCloseTo(7, 0);
    expect(l?.count).toBe(1);
    expect(s?.count).toBe(0); // OPS-3 never reached Done
    expect(m?.team_ct_p50).toBeCloseTo(5, 0); // median of [3,7]
    expect(l?.team_ct_p50).toBeCloseTo(5, 0);
  });
});

describe('computeAgingWIP', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('excludes Done/Finalizada/Cancelled/Cancelado, computes days_in_status, sorts desc', () => {
    const issues: CoreIssueWithTitle[] = [
      withTitle(issue('OPS-1', { status: 'Done', talla: 'M', last_transition_at: '2026-05-04T00:00:00Z' }), 'Fix login'),
      withTitle(issue('OPS-2', { status: 'Cancelado', talla: 'L', last_transition_at: '2026-05-30T00:00:00Z' }), 'Old idea'),
      withTitle(issue('OPS-3', { status: 'In Progress', talla: 'S', assignee_id: 'u1', created_at: '2026-05-20T00:00:00Z', last_transition_at: '2026-05-20T00:00:00Z' }), 'Update config'),
      withTitle(issue('OPS-4', { status: 'Blocked', talla: 'XL', assignee_id: 'u2', created_at: '2026-05-28T00:00:00Z', last_transition_at: null }), 'Blocked thing'),
    ];

    const aging = computeAgingWIP(issues, {}, now);

    expect(aging).toHaveLength(2);
    // OPS-3: last_transition_at 05-20 -> 12 days; OPS-4: no last_transition_at, falls back to created_at 05-28 -> 4 days
    expect(aging[0].issue_id).toBe('OPS-3');
    expect(aging[0].days_in_status).toBe(12);
    expect(aging[0].title).toBe('Update config');
    expect(aging[1].issue_id).toBe('OPS-4');
    expect(aging[1].days_in_status).toBe(4);
  });

  it('filters by assignee and talla but ignores the status param (matches buildWhereClause override)', () => {
    const issues: CoreIssueWithTitle[] = [
      withTitle(issue('OPS-1', { status: 'In Progress', talla: 'S', assignee_id: 'u1', last_transition_at: '2026-05-25T00:00:00Z' }), 'A'),
      withTitle(issue('OPS-2', { status: 'Blocked', talla: 'M', assignee_id: 'u2', last_transition_at: '2026-05-25T00:00:00Z' }), 'B'),
    ];
    const byAssignee = computeAgingWIP(issues, { assignee: 'u1' }, now);
    expect(byAssignee.map(a => a.issue_id)).toEqual(['OPS-1']);

    const byTalla = computeAgingWIP(issues, { talla: 'M' }, now);
    expect(byTalla.map(a => a.issue_id)).toEqual(['OPS-2']);
  });
});

describe('computeThroughputWeekly', () => {
  it('groups Done-transition occurrences by ISO week (Monday) with by_talla breakdown', () => {
    const issues: CoreIssue[] = [
      issue('OPS-1', { talla: 'M', assignee_id: 'u1' }),
      issue('OPS-2', { talla: 'L', assignee_id: 'u1' }),
      issue('OPS-3', { talla: 'S', assignee_id: 'u2' }),
    ];
    // Week of Mon 2026-05-04: OPS-1 (M) done Wed 05-06; OPS-3 (S) done Fri 05-08
    // Week of Mon 2026-05-11: OPS-2 (L) done Tue 05-12
    const transitions: CoreTransition[] = [
      { issue_id: 'OPS-1', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-06T10:00:00Z' },
      { issue_id: 'OPS-3', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-08T10:00:00Z' },
      { issue_id: 'OPS-2', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-12T10:00:00Z' },
    ];

    const result = computeThroughputWeekly(issues, transitions, { from: '2026-05-01', to: '2026-05-31' });

    expect(result).toEqual([
      { week: '2026-05-04', count: 2, by_talla: { S: 1, M: 1, L: 0, XL: 0 } },
      { week: '2026-05-11', count: 1, by_talla: { S: 0, M: 0, L: 1, XL: 0 } },
    ]);
  });

  it('filters by assignee', () => {
    const issues: CoreIssue[] = [
      issue('OPS-1', { talla: 'M', assignee_id: 'u1' }),
      issue('OPS-2', { talla: 'L', assignee_id: 'u2' }),
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'OPS-1', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-06T10:00:00Z' },
      { issue_id: 'OPS-2', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-06T10:00:00Z' },
    ];
    const result = computeThroughputWeekly(issues, transitions, { from: '2026-05-01', to: '2026-05-31', assignee: 'u1' });
    expect(result).toEqual([{ week: '2026-05-04', count: 1, by_talla: { S: 0, M: 1, L: 0, XL: 0 } }]);
  });

  it('defaults window to the last 56 days ending at `now`', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const issues: CoreIssue[] = [issue('OPS-1', { talla: 'M' }), issue('OPS-2', { talla: 'S' })];
    const transitions: CoreTransition[] = [
      // > 56 days before now -> excluded
      { issue_id: 'OPS-1', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-04-01T00:00:00Z' },
      // within last 56 days -> included
      { issue_id: 'OPS-2', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-20T00:00:00Z' },
    ];
    const result = computeThroughputWeekly(issues, transitions, {}, now);
    expect(result).toHaveLength(1);
    expect(result[0].by_talla.S).toBe(1);
  });
});

describe('computeCFD', () => {
  it('buckets each issue by its status as-of end-of-day, using latest transition <= day else current status', () => {
    const issues: CoreIssue[] = [
      issue('OPS-1', { status: 'Done', created_at: '2026-05-01T00:00:00Z' }),
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'OPS-1', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-05-02T10:00:00Z' },
      { issue_id: 'OPS-1', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-05-04T10:00:00Z' },
    ];

    const points = computeCFD(issues, transitions, { from: '2026-05-01', to: '2026-05-05' });

    expect(points.map(p => p.date)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05']);
    // Day 1: no transition yet <= day -> falls back to issue.status ('Done')
    expect(points[0].done).toBe(1);
    // Day 2: transitioned to In Progress during the day -> in_progress
    expect(points[1].in_progress).toBe(1);
    expect(points[1].done).toBe(0);
    // Day 3: still In Progress (no new transition)
    expect(points[2].in_progress).toBe(1);
    // Day 4: transitioned to Done
    expect(points[3].done).toBe(1);
    expect(points[3].in_progress).toBe(0);
    // Day 5: still Done
    expect(points[4].done).toBe(1);
  });

  it('excludes issues not yet created (created_at > day end) and respects assignee filter', () => {
    const issues: CoreIssue[] = [
      issue('OPS-1', { status: 'To Do', assignee_id: 'u1', created_at: '2026-05-01T00:00:00Z' }),
      issue('OPS-2', { status: 'To Do', assignee_id: 'u2', created_at: '2026-05-03T00:00:00Z' }),
    ];
    const points = computeCFD(issues, [], { from: '2026-05-01', to: '2026-05-03', assignee: 'u1' });
    expect(points[0].todo).toBe(1); // only OPS-1 exists and matches assignee
    expect(points[2].todo).toBe(1); // OPS-2 excluded by assignee filter even though created by day 3
  });

  it('defaults window to the last 30 days ending at `now`', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const issues: CoreIssue[] = [issue('OPS-1', { status: 'To Do', created_at: '2026-01-01T00:00:00Z' })];
    const points = computeCFD(issues, [], {}, now);
    expect(points[0].date).toBe('2026-05-02');
    expect(points[points.length - 1].date).toBe('2026-06-01');
  });
});
