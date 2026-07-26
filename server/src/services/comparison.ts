import Database from 'better-sqlite3';
import { STATUS_CATEGORIES } from './statusCategories';
import type { ComparisonResult, ComparisonPeriod } from '../types';

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

function getThroughput(db: Database.Database, weekStart: string, weekEnd: string, assignee?: string | null): number {
  const doneIn = DONE_STATUSES.map(() => '?').join(',');
  const assigneeClause = assignee
    ? `AND issue_id IN (SELECT id FROM issues WHERE assignee_id = ?)`
    : '';
  const row = db.prepare(`
    SELECT COUNT(DISTINCT issue_id) AS count
    FROM transitions
    WHERE to_status IN (${doneIn})
      AND transitioned_at >= ?
      AND transitioned_at < ?
      ${assigneeClause}
  `).get(
    ...DONE_STATUSES,
    weekStart + 'T00:00:00Z',
    weekEnd + 'T00:00:00Z',
    ...(assignee ? [assignee] : [])
  ) as { count: number };
  return row.count;
}

function getWipSnapshot(db: Database.Database, weekEnd: string, assignee?: string | null): number {
  const wipExIn = WIP_EXCLUDED.map(() => '?').join(',');
  const assigneeClause = assignee
    ? `AND issue_id IN (SELECT id FROM issues WHERE assignee_id = ?)`
    : '';
  const row = db.prepare(`
    WITH last_before AS (
      SELECT issue_id, to_status,
        ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY transitioned_at DESC) AS rn
      FROM transitions
      WHERE transitioned_at < ?
    )
    SELECT COUNT(*) AS count
    FROM last_before
    WHERE rn = 1
      AND to_status NOT IN (${wipExIn})
      ${assigneeClause}
  `).get(
    weekEnd + 'T00:00:00Z',
    ...WIP_EXCLUDED,
    ...(assignee ? [assignee] : [])
  ) as { count: number };
  return row.count;
}

export function getComparison(
  db: Database.Database,
  opts: { week?: string; now?: Date; assignee?: string | null } = {}
): ComparisonResult {
  const now = opts.now ?? new Date();
  const week = opts.week ?? isoMonday(now);
  const prevWeek = addDays(week, -7);
  const nextWeek = addDays(week, 7);
  const assignee = opts.assignee ?? null;

  return {
    week,
    prevWeek,
    throughput: period(
      getThroughput(db, week, nextWeek, assignee),
      getThroughput(db, prevWeek, week, assignee)
    ),
    wip: period(
      getWipSnapshot(db, nextWeek, assignee),
      getWipSnapshot(db, week, assignee)
    ),
  };
}
