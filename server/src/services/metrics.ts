import Database from 'better-sqlite3';
import type { FilterParams, KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, Talla } from '../types';

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildWhereClause(params: FilterParams): { where: string; args: any[] } {
  const conditions: string[] = [];
  const args: any[] = [];

  if (params.assignee) {
    conditions.push('i.assignee_id = ?');
    args.push(params.assignee);
  }
  if (params.talla) {
    const tallas = params.talla.split(',').map(t => t.trim());
    conditions.push(`i.talla IN (${tallas.map(() => '?').join(',')})`);
    args.push(...tallas);
  }
  if (params.status) {
    const statuses = params.status.split(',').map(s => s.trim());
    conditions.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }

  return {
    where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    args,
  };
}

export function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
  const { where, args } = buildWhereClause(params);
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const rows = db.prepare(`
    SELECT
      MIN(t_start.transitioned_at) AS start_at,
      t_end.transitioned_at        AS end_at,
      i.talla
    FROM issues i
    JOIN transitions t_start ON t_start.issue_id = i.id AND t_start.to_status IN ('In Progress','IN PROGRESS','EN CURSO','In development','To Do','TO DO','Tareas por hacer','Por Hacer','Backlog')
    JOIN transitions t_end   ON t_end.issue_id   = i.id AND t_end.to_status   IN ('Done','Finalizada')
    ${where ? where.replace('WHERE', 'WHERE') : 'WHERE 1=1'}
      AND t_end.transitioned_at >= ? AND t_end.transitioned_at <= ?
    GROUP BY i.id, t_end.transitioned_at
    ORDER BY start_at
  `).all(...args, fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z') as any[];

  const minDays: Record<string, number> = { XL: 1, L: 4 / 24, M: 1 / 24, S: 1 / 24 };

  return rows
    .map(r => ({ ct: (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / (1000 * 60 * 60 * 24), talla: r.talla }))
    .filter(({ ct, talla }) => ct >= (minDays[talla] ?? 1 / 24))
    .map(({ ct }) => ct)
    .sort((a, b) => a - b);
}

export function getKPIs(db: Database.Database, params: FilterParams): KPIMetrics {
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const wipRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','Finalizada','Cancelled','Cancelado','To Do','Tareas por hacer','Backlog','Por Hacer')
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(...(params.assignee ? [params.assignee] : [])) as any;

  const throughputRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status IN ('Done','Finalizada')
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any;

  const cycleTimes = getCycleTimes(db, params);
  const agingThreshold = Math.max(1, parseInt(process.env.AGING_THRESHOLD_DAYS ?? '7', 10) || 7);
  const agingCutoff = new Date(Date.now() - agingThreshold * 24 * 60 * 60 * 1000).toISOString();

  const blockedRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','Finalizada','Cancelled','Cancelado','To Do','Tareas por hacer','Backlog','Por Hacer')
      AND i.last_transition_at <= ?
      ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(agingCutoff, ...(params.assignee ? [params.assignee] : [])) as any;

  return {
    wip: wipRow.count,
    throughput: throughputRow.count,
    cycle_time_p50: percentile(cycleTimes, 50),
    cycle_time_p85: percentile(cycleTimes, 85),
    blocked_count: blockedRow.count,
  };
}

export function getCycleTimeByTalla(db: Database.Database, params: FilterParams): TallaMetric[] {
  const tallas: Talla[] = ['S', 'M', 'L', 'XL'];
  const allCTs = getCycleTimes(db, params);
  const teamP50 = percentile(allCTs, 50);

  return tallas.map(talla => {
    const cts = getCycleTimes(db, { ...params, talla });
    return {
      talla,
      ct_p50: percentile(cts, 50),
      count: cts.length,
      team_ct_p50: teamP50,
    };
  });
}

export function getCFD(db: Database.Database, params: FilterParams): CFDPoint[] {
  const fromDate = params.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = params.to ?? new Date().toISOString().slice(0, 10);

  const toBucket = (s: string): keyof CFDPoint | null => {
    if (['To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'].includes(s)) return 'todo';
    if (['Ready for Development', 'Prioritized', 'Committed', 'Prioritization'].includes(s)) return 'in_review';
    if (['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development'].includes(s)) return 'in_progress';
    if (['Blocked'].includes(s)) return 'in_qa';
    if (['Done', 'Finalizada', 'Cancelled', 'Cancelado', 'Ready for deploy'].includes(s)) return 'done';
    return null;
  };

  const points: CFDPoint[] = [];

  const assigneeClause = params.assignee ? 'AND i.assignee_id = ?' : '';
  const assigneeArgs = params.assignee ? [params.assignee] : [];

  const stmt = db.prepare(`
    SELECT
      COALESCE(
        (SELECT t.to_status FROM transitions t
         WHERE t.issue_id = i.id AND t.transitioned_at <= ?
         ORDER BY t.transitioned_at DESC LIMIT 1),
        i.status
      ) AS last_status
    FROM issues i
    WHERE i.created_at <= ?
    ${assigneeClause}
  `);

  const run = db.transaction(() => {
    let cursor = new Date(fromDate);
    const end = new Date(toDate);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10) + 'T23:59:59Z';
      const row: CFDPoint = { date: cursor.toISOString().slice(0, 10), todo: 0, in_progress: 0, in_review: 0, in_qa: 0, done: 0 };

      const rows = stmt.all(dateStr, dateStr, ...assigneeArgs) as { last_status: string }[];
      for (const { last_status } of rows) {
        const bucket = toBucket(last_status);
        if (bucket) (row as any)[bucket]++;
      }

      points.push(row);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  run();
  return points;
}

export function getThroughputWeekly(db: Database.Database, params: FilterParams): ThroughputWeek[] {
  const fromDate = params.from ?? new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = params.to ?? new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      t.transitioned_at AS transitioned_at,
      i.talla
    FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status IN ('Done','Finalizada')
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).all(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any[];

  // El lunes de la semana se calcula en JS, no con date(...,'weekday 1','-7 days'):
  // ese timestamp viene de Jira como "...-0300" (offset sin colon), que el date() de
  // SQLite no parsea y devuelve NULL para todas las filas (mismo problema que con
  // ct_days y days_in_status).
  const weekStart = (iso: string): string => {
    const d = new Date(iso);
    const day = d.getUTCDay(); // 0=domingo ... 6=sábado
    const diff = (day + 6) % 7; // días desde el lunes
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  };

  const weeks = new Map<string, ThroughputWeek>();
  for (const row of rows) {
    const week = weekStart(row.transitioned_at);
    if (!weeks.has(week)) {
      weeks.set(week, { week, count: 0, by_talla: { S: 0, M: 0, L: 0, XL: 0 } });
    }
    const w = weeks.get(week)!;
    w.count += 1;
    if (row.talla && ['S', 'M', 'L', 'XL'].includes(row.talla)) {
      w.by_talla[row.talla as Talla] += 1;
    }
  }

  return Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week));
}

export function getAgingWIP(db: Database.Database, params: FilterParams): AgingIssue[] {
  const { where, args } = buildWhereClause({ ...params, status: undefined });
  const rows = db.prepare(`
    SELECT
      i.id AS issue_id,
      i.title,
      i.talla,
      i.status,
      i.assignee_id,
      COALESCE(i.last_transition_at, i.created_at) AS _last_moved_at
    FROM issues i
    ${where || 'WHERE 1=1'} AND i.status NOT IN ('Done','Finalizada','Cancelled','Cancelado')
  `).all(...args) as any[];

  // days_in_status se calcula en JS: julianday('now') - julianday(...) devuelve NULL
  // para los timestamps de Jira con offset "-0300" (sin colon) — mismo problema que
  // con ct_days en /api/issues.
  const now = Date.now();
  const aging: AgingIssue[] = rows.map(({ _last_moved_at, ...issue }) => ({
    ...issue,
    days_in_status: Math.floor((now - new Date(_last_moved_at).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  aging.sort((a, b) => b.days_in_status - a.days_in_status);
  return aging;
}

