import { percentile } from './stats';
import type { CoreIssue, CoreTransition, CoreFilter, KPIMetrics } from './types';

const DONE = ['Done', 'Finalizada'];
const START = ['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development', 'To Do', 'TO DO', 'Tareas por hacer', 'Por Hacer', 'Backlog'];
const WIP_EXCLUDED = ['Done', 'Finalizada', 'Cancelled', 'Cancelado', 'To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'];
const MIN_DAYS: Record<string, number> = { XL: 1, L: 4 / 24, M: 1 / 24, S: 1 / 24 };
const MS_DAY = 1000 * 60 * 60 * 24;

function byId<T extends { issue_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { (m.get(r.issue_id) ?? m.set(r.issue_id, []).get(r.issue_id)!).push(r); }
  return m;
}

export function computeCycleTimes(issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter): number[] {
  const from = (params.from ?? '2000-01-01') + 'T00:00:00Z';
  const to = (params.to ?? '2099-12-31') + 'T23:59:59Z';
  const tallas = params.talla ? params.talla.split(',').map(t => t.trim()) : null;
  const statuses = params.status ? params.status.split(',').map(s => s.trim()) : null;
  const tByIssue = byId(transitions);

  const cts: number[] = [];
  for (const i of issues) {
    if (params.assignee && i.assignee_id !== params.assignee) continue;
    if (tallas && (!i.talla || !tallas.includes(i.talla))) continue;
    if (statuses && !statuses.includes(i.status)) continue;
    const ts = tByIssue.get(i.id) ?? [];
    const starts = ts.filter(t => START.includes(t.to_status)).map(t => t.transitioned_at);
    if (starts.length === 0) continue;
    const startAt = starts.reduce((a, b) => (a < b ? a : b));
    const ends = ts.filter(t => DONE.includes(t.to_status) && t.transitioned_at >= from && t.transitioned_at <= to);
    for (const end of ends) {
      const ct = (new Date(end.transitioned_at).getTime() - new Date(startAt).getTime()) / MS_DAY;
      if (ct >= (MIN_DAYS[i.talla ?? ''] ?? 1 / 24)) cts.push(ct);
    }
  }
  return cts.sort((a, b) => a - b);
}

export function computeKpis(
  issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter,
  agingThresholdDays: number, now: Date = new Date(),
): KPIMetrics {
  const from = (params.from ?? '2000-01-01') + 'T00:00:00Z';
  const to = (params.to ?? '2099-12-31') + 'T23:59:59Z';
  const byAssignee = (i: CoreIssue) => !params.assignee || i.assignee_id === params.assignee;

  const wip = issues.filter(i => byAssignee(i) && !WIP_EXCLUDED.includes(i.status)).length;

  const assigneeById = new Map(issues.map(i => [i.id, i.assignee_id]));
  const throughput = transitions.filter(t =>
    DONE.includes(t.to_status) && t.transitioned_at >= from && t.transitioned_at <= to &&
    (!params.assignee || assigneeById.get(t.issue_id) === params.assignee)
  ).length;

  const cutoff = new Date(now.getTime() - Math.max(1, agingThresholdDays) * MS_DAY).toISOString();
  const blocked_count = issues.filter(i =>
    byAssignee(i) && !WIP_EXCLUDED.includes(i.status) && i.last_transition_at != null && i.last_transition_at <= cutoff
  ).length;

  const cts = computeCycleTimes(issues, transitions, params);
  return {
    wip, throughput,
    cycle_time_p50: percentile(cts, 50),
    cycle_time_p85: percentile(cts, 85),
    blocked_count,
  };
}
