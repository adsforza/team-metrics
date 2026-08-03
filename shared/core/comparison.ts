import { STATUS_CATEGORIES } from './statusCategories';
import type { CoreIssue, CoreTransition, ComparisonResult, ComparisonPeriod } from './types';

const DONE_STATUSES = [...STATUS_CATEGORIES.done] as string[];

const WIP_EXCLUDED = [
  ...STATUS_CATEGORIES.done,
  ...STATUS_CATEGORIES.cancelled,
  ...STATUS_CATEGORIES.todo,
] as string[];

function isoMonday(date: Date): string {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const mon = new Date(date);
  mon.setUTCDate(date.getUTCDate() - diff);
  return mon.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function period(current: number, previous: number): ComparisonPeriod {
  return {
    current,
    previous,
    delta: current - previous,
    deltaPct: previous === 0 ? null : Math.round((current - previous) / previous * 100),
  };
}

// Mirrors: SELECT COUNT(DISTINCT issue_id) FROM transitions
//          WHERE to_status IN (DONE) AND transitioned_at >= weekStart AND transitioned_at < weekEnd
//          [AND issue_id IN (SELECT id FROM issues WHERE assignee_id = ?)]
function getThroughput(
  transitions: CoreTransition[],
  assigneeById: Map<string, string | null>,
  weekStart: string,
  weekEnd: string,
  assignee?: string | null
): number {
  const start = weekStart + 'T00:00:00Z';
  const end = weekEnd + 'T00:00:00Z';
  const issueIds = new Set<string>();
  for (const t of transitions) {
    if (!DONE_STATUSES.includes(t.to_status)) continue;
    if (!(t.transitioned_at >= start && t.transitioned_at < end)) continue;
    if (assignee && assigneeById.get(t.issue_id) !== assignee) continue;
    issueIds.add(t.issue_id);
  }
  return issueIds.size;
}

// Mirrors: for each issue_id, take the last transition with transitioned_at < weekEnd
//          (issues with no such transition are excluded entirely, regardless of current status);
//          count those whose to_status is NOT in WIP_EXCLUDED
//          [AND issue_id IN (SELECT id FROM issues WHERE assignee_id = ?)]
function getWipSnapshot(
  transitions: CoreTransition[],
  assigneeById: Map<string, string | null>,
  weekEnd: string,
  assignee?: string | null
): number {
  const end = weekEnd + 'T00:00:00Z';
  const lastBefore = new Map<string, CoreTransition>();
  for (const t of transitions) {
    if (!(t.transitioned_at < end)) continue;
    const prev = lastBefore.get(t.issue_id);
    if (!prev || t.transitioned_at > prev.transitioned_at) {
      lastBefore.set(t.issue_id, t);
    }
  }
  let count = 0;
  for (const [issueId, t] of lastBefore) {
    if (WIP_EXCLUDED.includes(t.to_status)) continue;
    if (assignee && assigneeById.get(issueId) !== assignee) continue;
    count++;
  }
  return count;
}

export function computeComparison(
  issues: CoreIssue[],
  transitions: CoreTransition[],
  opts: { week?: string; now?: Date; assignee?: string | null } = {}
): ComparisonResult {
  const now = opts.now ?? new Date();
  const week = opts.week ?? isoMonday(now);
  const prevWeek = addDays(week, -7);
  const nextWeek = addDays(week, 7);
  const assignee = opts.assignee ?? null;

  const assigneeById = new Map(issues.map(i => [i.id, i.assignee_id]));

  return {
    week,
    prevWeek,
    throughput: period(
      getThroughput(transitions, assigneeById, week, nextWeek, assignee),
      getThroughput(transitions, assigneeById, prevWeek, week, assignee)
    ),
    wip: period(
      getWipSnapshot(transitions, assigneeById, nextWeek, assignee),
      getWipSnapshot(transitions, assigneeById, week, assignee)
    ),
  };
}
