// shared/core/metricsExtra.ts
// Pure, in-memory port of the remaining server/src/services/metrics.ts functions:
// getThroughputWeekly, getCFD, getAgingWIP, getCycleTimeByTalla.
// SQL data access is replaced by equivalents over plain arrays; every other bit of logic
// (weekStart in JS, the toBucket map, days_in_status arithmetic, MIN_DAYS filtering via
// computeCycleTimes) is transcribed unchanged, preserving exact status literals and
// string/lexicographic timestamp comparisons (SQLite TEXT semantics).
import { percentile } from './stats';
import { computeCycleTimes } from './metrics';
import type {
  CoreIssue, CoreTransition, CoreFilter, CoreIssueWithTitle,
  Talla, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue,
} from './types';

const MS_DAY = 1000 * 60 * 60 * 24;
const DONE = ['Done', 'Finalizada'];
const AGING_EXCLUDED = ['Done', 'Finalizada', 'Cancelled', 'Cancelado'];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeCycleTimeByTalla(
  issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter,
): TallaMetric[] {
  const tallas: Talla[] = ['S', 'M', 'L', 'XL'];
  const allCTs = computeCycleTimes(issues, transitions, params);
  const teamP50 = percentile(allCTs, 50);

  return tallas.map(talla => {
    const cts = computeCycleTimes(issues, transitions, { ...params, talla });
    return {
      talla,
      ct_p50: percentile(cts, 50),
      count: cts.length,
      team_ct_p50: teamP50,
    };
  });
}

export function computeCFD(
  issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter, now: Date = new Date(),
): CFDPoint[] {
  const fromDate = params.from ?? isoDay(new Date(now.getTime() - 30 * MS_DAY));
  const toDate = params.to ?? isoDay(now);

  const toBucket = (s: string): keyof Omit<CFDPoint, 'date'> | null => {
    if (['To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'].includes(s)) return 'todo';
    if (['Ready for Development', 'Prioritized', 'Committed', 'Prioritization'].includes(s)) return 'in_review';
    if (['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development'].includes(s)) return 'in_progress';
    if (['Blocked'].includes(s)) return 'in_qa';
    if (['Done', 'Finalizada', 'Cancelled', 'Cancelado', 'Ready for deploy'].includes(s)) return 'done';
    return null;
  };

  // Per-issue transitions sorted ascending, so "latest transition <= day-end" is found by
  // walking forward and keeping the last one that still qualifies (mirrors the SQL
  // `ORDER BY transitioned_at DESC LIMIT 1 WHERE transitioned_at <= ?`).
  const transByIssue = new Map<string, CoreTransition[]>();
  for (const t of transitions) {
    if (!transByIssue.has(t.issue_id)) transByIssue.set(t.issue_id, []);
    transByIssue.get(t.issue_id)!.push(t);
  }
  for (const arr of transByIssue.values()) {
    arr.sort((a, b) => a.transitioned_at.localeCompare(b.transitioned_at));
  }

  const points: CFDPoint[] = [];
  const cursor = new Date(fromDate);
  const end = new Date(toDate);

  while (cursor <= end) {
    const dateStr = isoDay(cursor) + 'T23:59:59Z';
    const row: CFDPoint = { date: isoDay(cursor), todo: 0, in_progress: 0, in_review: 0, in_qa: 0, done: 0 };

    for (const issue of issues) {
      if (issue.created_at > dateStr) continue;
      if (params.assignee && issue.assignee_id !== params.assignee) continue;

      let lastStatus = issue.status;
      for (const t of transByIssue.get(issue.id) ?? []) {
        if (t.transitioned_at <= dateStr) lastStatus = t.to_status;
        else break;
      }

      const bucket = toBucket(lastStatus);
      if (bucket) row[bucket]++;
    }

    points.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export function computeThroughputWeekly(
  issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter, now: Date = new Date(),
): ThroughputWeek[] {
  const fromDate = params.from ?? isoDay(new Date(now.getTime() - 56 * MS_DAY));
  const toDate = params.to ?? isoDay(now);
  const fromTs = fromDate + 'T00:00:00Z';
  const toTs = toDate + 'T23:59:59Z';

  const issueById = new Map(issues.map(i => [i.id, i]));

  // El lunes de la semana se calcula en JS, no con date(...,'weekday 1','-7 days'): ese
  // timestamp viene de Jira como "...-0300" (offset sin colon), que el date() de SQLite
  // no parsea y devuelve NULL para todas las filas (mismo problema que con ct_days y
  // days_in_status).
  const weekStart = (iso: string): string => {
    const d = new Date(iso);
    const day = d.getUTCDay(); // 0=domingo ... 6=sábado
    const diff = (day + 6) % 7; // días desde el lunes
    d.setUTCDate(d.getUTCDate() - diff);
    return isoDay(d);
  };

  const weeks = new Map<string, ThroughputWeek>();
  for (const t of transitions) {
    if (!DONE.includes(t.to_status)) continue;
    if (t.transitioned_at < fromTs || t.transitioned_at > toTs) continue;

    const issue = issueById.get(t.issue_id);
    if (!issue) continue;
    if (params.assignee && issue.assignee_id !== params.assignee) continue;

    const week = weekStart(t.transitioned_at);
    if (!weeks.has(week)) {
      weeks.set(week, { week, count: 0, by_talla: { S: 0, M: 0, L: 0, XL: 0 } });
    }
    const w = weeks.get(week)!;
    w.count += 1;
    if (issue.talla && ['S', 'M', 'L', 'XL'].includes(issue.talla)) {
      w.by_talla[issue.talla] += 1;
    }
  }

  return Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week));
}

export function computeAgingWIP(
  issues: CoreIssueWithTitle[], params: CoreFilter, now: Date = new Date(),
): AgingIssue[] {
  // Mirrors buildWhereClause({ ...params, status: undefined }): assignee + talla filters
  // apply, but any caller-supplied `status` param is deliberately ignored here — aging
  // always restricts to non-done/cancelled statuses below.
  const tallas = params.talla ? params.talla.split(',').map(t => t.trim()) : null;

  const filtered = issues.filter(i => {
    if (params.assignee && i.assignee_id !== params.assignee) return false;
    if (tallas && (!i.talla || !tallas.includes(i.talla))) return false;
    if (AGING_EXCLUDED.includes(i.status)) return false;
    return true;
  });

  // days_in_status se calcula en JS: julianday('now') - julianday(...) devuelve NULL para
  // los timestamps de Jira con offset "-0300" (sin colon) — mismo problema que con ct_days
  // en /api/issues.
  const nowMs = now.getTime();
  const aging: AgingIssue[] = filtered.map(i => {
    const lastMovedAt = i.last_transition_at ?? i.created_at;
    return {
      issue_id: i.id,
      title: i.title,
      talla: i.talla,
      status: i.status,
      assignee_id: i.assignee_id,
      days_in_status: Math.floor((nowMs - new Date(lastMovedAt).getTime()) / MS_DAY),
    };
  });

  aging.sort((a, b) => b.days_in_status - a.days_in_status);
  return aging;
}
