import { describe, it, expect, beforeEach } from 'vitest';
import { computeComparison } from './comparison';
import type { CoreIssue, CoreTransition } from './types';

// Week under test: Mon 2026-06-22 → Sun 2026-06-28
// Previous week:   Mon 2026-06-15 → Sun 2026-06-21
const NOW = new Date('2026-06-25T12:00:00Z');
const WEEK      = '2026-06-22';
const PREV_WEEK = '2026-06-15';

let issuesById: Map<string, CoreIssue>;
let transitions: CoreTransition[];

function seedTransition(issueId: string, fromStatus: string, toStatus: string, at: string) {
  if (!issuesById.has(issueId)) {
    issuesById.set(issueId, {
      id: issueId, status: toStatus, assignee_id: null,
      talla: 'M', created_at: '2026-01-01T00:00:00Z', last_transition_at: at,
    });
  } else {
    issuesById.get(issueId)!.status = toStatus;
  }
  transitions.push({ issue_id: issueId, from_status: fromStatus, to_status: toStatus, transitioned_at: at });
}

function issues(): CoreIssue[] {
  return [...issuesById.values()];
}

beforeEach(() => {
  issuesById = new Map();
  transitions = [];
});

describe('computeComparison', () => {
  it('returns zero counts when no transitions exist', () => {
    const r = computeComparison([], [], { now: NOW });
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

    const r = computeComparison(issues(), transitions, { now: NOW });
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

    const r = computeComparison(issues(), transitions, { now: NOW });
    // End of prev week (before 2026-06-22T00:00:00Z): A was In Progress, B not started → wip.previous=1
    expect(r.wip.previous).toBe(1);
    // End of current week (before 2026-06-29T00:00:00Z): A is Done, B still In Progress → wip.current=1
    expect(r.wip.current).toBe(1);
  });

  it('deltaPct is null when previous is 0', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z');

    const r = computeComparison(issues(), transitions, { now: NOW });
    expect(r.throughput.current).toBe(1);
    expect(r.throughput.previous).toBe(0);
    expect(r.throughput.deltaPct).toBeNull();
  });

  it('opts.week selects a past week correctly', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-17T10:00:00Z'); // in prev week (2026-06-15)

    const r = computeComparison(issues(), transitions, { week: PREV_WEEK, now: NOW });
    expect(r.week).toBe(PREV_WEEK);
    expect(r.throughput.current).toBe(1);
  });

  it('opts.assignee restricts throughput and wip to that member', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z'); // done this week
    seedTransition('B', 'To Do', 'In Progress', '2026-06-23T10:00:00Z'); // active this week
    seedTransition('C', 'In Progress', 'Done', '2026-06-24T10:00:00Z'); // done this week (other person)
    seedTransition('D', 'To Do', 'In Progress', '2026-06-23T10:00:00Z'); // active this week (other person)
    issuesById.get('A')!.assignee_id = 'u1';
    issuesById.get('B')!.assignee_id = 'u1';
    issuesById.get('C')!.assignee_id = 'u2';
    issuesById.get('D')!.assignee_id = 'u2';

    const all = computeComparison(issues(), transitions, { now: NOW });
    expect(all.throughput.current).toBe(2); // A + C
    expect(all.wip.current).toBe(2);        // B + D

    const u1 = computeComparison(issues(), transitions, { now: NOW, assignee: 'u1' });
    expect(u1.throughput.current).toBe(1);  // only A
    expect(u1.wip.current).toBe(1);         // only B
  });
});
