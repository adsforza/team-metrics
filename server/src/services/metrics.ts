import Database from 'better-sqlite3';
import type { FilterParams, KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, PersonMetrics, Talla, Score } from '../types';

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

function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
  const { where, args } = buildWhereClause(params);
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const rows = db.prepare(`
    SELECT
      t_start.transitioned_at AS start_at,
      t_end.transitioned_at   AS end_at
    FROM issues i
    JOIN transitions t_start ON t_start.issue_id = i.id AND t_start.to_status = 'In Progress'
    JOIN transitions t_end   ON t_end.issue_id   = i.id AND t_end.to_status   = 'Done'
    ${where ? where.replace('WHERE', 'WHERE') : 'WHERE 1=1'}
      AND t_end.transitioned_at >= ? AND t_end.transitioned_at <= ?
    ORDER BY t_start.transitioned_at
  `).all(...args, fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z') as any[];

  return rows
    .map(r => (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / (1000 * 60 * 60 * 24))
    .sort((a, b) => a - b);
}

export function getKPIs(db: Database.Database, params: FilterParams): KPIMetrics {
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const wipRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','To Do')
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(...(params.assignee ? [params.assignee] : [])) as any;

  const throughputRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any;

  const cycleTimes = getCycleTimes(db, params);
  const agingThreshold = Number(process.env.AGING_THRESHOLD_DAYS ?? 7);

  const blockedRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','To Do')
      AND i.last_transition_at <= datetime('now', '-${agingThreshold} days')
      ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(...(params.assignee ? [params.assignee] : [])) as any;

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

  const statuses = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done'];
  const points: CFDPoint[] = [];

  let cursor = new Date(fromDate);
  const end = new Date(toDate);

  while (cursor <= end) {
    const dateStr = cursor.toISOString();
    const row: any = { date: cursor.toISOString().slice(0, 10), todo: 0, in_progress: 0, in_review: 0, in_qa: 0, done: 0 };

    for (const status of statuses) {
      const count = (db.prepare(`
        SELECT COUNT(*) as c FROM issues i WHERE i.created_at <= ?
          AND (i.status = ? OR EXISTS (
            SELECT 1 FROM transitions t WHERE t.issue_id = i.id AND t.to_status = ? AND t.transitioned_at <= ?
          ))
          ${params.assignee ? 'AND i.assignee_id = ?' : ''}
      `).get(dateStr, status, status, dateStr, ...(params.assignee ? [params.assignee] : [])) as any).c;

      const key = status.toLowerCase().replace(/ /g, '_');
      row[key] = count;
    }

    points.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export function getThroughputWeekly(db: Database.Database, params: FilterParams): ThroughputWeek[] {
  const fromDate = params.from ?? new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = params.to ?? new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      date(t.transitioned_at, 'weekday 1', '-7 days') AS week,
      i.talla,
      COUNT(*) AS count
    FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
    GROUP BY week, i.talla
    ORDER BY week
  `).all(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any[];

  const weeks = new Map<string, ThroughputWeek>();
  for (const row of rows) {
    if (!weeks.has(row.week)) {
      weeks.set(row.week, { week: row.week, count: 0, by_talla: { S: 0, M: 0, L: 0, XL: 0 } });
    }
    const w = weeks.get(row.week)!;
    w.count += row.count;
    if (row.talla && ['S', 'M', 'L', 'XL'].includes(row.talla)) {
      w.by_talla[row.talla as Talla] += row.count;
    }
  }

  return Array.from(weeks.values());
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
      CAST((julianday('now') - julianday(COALESCE(i.last_transition_at, i.created_at))) AS INTEGER) AS days_in_status
    FROM issues i
    ${where || 'WHERE 1=1'} AND i.status NOT IN ('Done')
    ORDER BY days_in_status DESC
  `).all(...args) as AgingIssue[];

  return rows;
}

export function getTeamMetrics(db: Database.Database, params: FilterParams): PersonMetrics[] {
  const members = db.prepare('SELECT * FROM team_members').all() as any[];
  const tallas: Talla[] = ['S', 'M', 'L', 'XL'];
  const TALLA_WEIGHT: Record<Talla, number> = { S: 1, M: 2, L: 4, XL: 8 };

  const personScores: Array<{ member: any; rawScore: number; metrics: Omit<PersonMetrics, 'score'> }> = [];

  for (const member of members) {
    const memberParams = { ...params, assignee: member.id };
    const kpi = getKPIs(db, memberParams);
    const cycleTimes = getCycleTimes(db, memberParams);

    const mix_tallas = Object.fromEntries(
      tallas.map(t => [t, getCycleTimes(db, { ...memberParams, talla: t }).length])
    ) as Record<Talla, number>;

    // Sparkline: throughput for last 4 weeks
    const sparkline: number[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const wkRow = db.prepare(`
        SELECT COUNT(*) as c FROM issues i
        JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
        WHERE i.assignee_id = ? AND t.transitioned_at >= ? AND t.transitioned_at < ?
      `).get(member.id, weekStart.toISOString(), weekEnd.toISOString()) as any;
      sparkline.push(wkRow.c);
    }

    // Weighted throughput
    const weightedThroughput = tallas.reduce((sum, t) => sum + mix_tallas[t] * TALLA_WEIGHT[t], 0);
    const ctP50 = percentile([...cycleTimes].sort((a, b) => a - b), 50);
    const rawScore = ctP50 ? weightedThroughput / ctP50 : weightedThroughput;

    personScores.push({
      member,
      rawScore,
      metrics: { member, throughput: kpi.throughput, ct_p50: ctP50, mix_tallas, blocked: kpi.blocked_count, sparkline },
    });
  }

  // Assign letter scores by quartile
  const sorted = [...personScores].sort((a, b) => b.rawScore - a.rawScore);
  const n = sorted.length;

  return sorted.map((p, i) => {
    const quartile = n === 1 ? 0 : i / (n - 1);
    const score: Score = quartile < 0.25 ? 'A' : quartile < 0.5 ? 'B' : quartile < 0.75 ? 'C' : 'D';
    return { ...p.metrics, score };
  });
}
