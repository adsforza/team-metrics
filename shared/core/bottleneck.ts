// shared/core/bottleneck.ts
// Pure, in-memory port of server/src/services/bottleneck.ts (getBottleneck).
// SQL data access (getDwellRows' correlated-subquery pass detection, getCurrentIssues'
// LEFT JOIN + GROUP BY MAX) is replaced by equivalents over plain arrays; every other
// bit of logic (per-state avg/p85, combined score, top issues, weekly trend, by_talla,
// sort) is transcribed unchanged, preserving exact status literals and string
// timestamp comparisons (mirroring SQLite TEXT semantics).
import { percentile } from './stats';
import { STATUS_CATEGORIES } from './statusCategories';
import type {
  Talla,
  CoreIssueWithTitle,
  CoreTransition,
  BottleneckResult,
  BottleneckState,
  BottleneckStateDetail,
  BottleneckScore,
  BottleneckTopIssue,
  BottleneckTallaBreakdown,
  BottleneckWeekPoint,
} from './types';

const LOOKBACK_WEEKS = 8;
const LOOKBACK_DAYS = LOOKBACK_WEEKS * 7;   // 56
const TOP_ISSUES_LIMIT = 8;
const MIN_SAMPLES_FOR_AVG = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];
const SEVERITY: Record<BottleneckScore, number> = { crítico: 3, alto: 2, medio: 1, normal: 0 };

const EXCLUDED = [...STATUS_CATEGORIES.done, ...STATUS_CATEGORIES.cancelled] as string[];

function isoMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();              // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = (day + 6) % 7;         // days to subtract to reach Monday
  const monday = new Date(d.getTime() - daysBack * MS_PER_DAY);
  return monday.toISOString().slice(0, 10);
}

interface ProcessedDwellRow {
  issue_id: string;
  status: string;
  entered_at: string;
  talla: Talla | null;
  dwell_days: number;
}

interface CurrentIssueRow {
  issue_id: string;
  title: string;
  talla: Talla | null;
  status: string;
  last_entry: string | null;
}

// Mirrors getDwellRows: for every transition t1 into a non-excluded status, find the
// earliest later transition t2 for the same issue whose from_status equals t1.to_status
// (i.e. the moment the issue left that state). Rows without such an exit, or whose exit
// falls before `from`, are dropped. Joined (INNER) against issues for talla — note this
// is independent of the issue's *current* status, since it captures historical passes.
function computeDwellRows(
  issues: CoreIssueWithTitle[],
  transitions: CoreTransition[],
  from: string,
): ProcessedDwellRow[] {
  const transByIssue = new Map<string, CoreTransition[]>();
  for (const t of transitions) {
    if (!transByIssue.has(t.issue_id)) transByIssue.set(t.issue_id, []);
    transByIssue.get(t.issue_id)!.push(t);
  }
  const issueById = new Map(issues.map(i => [i.id, i]));

  const rows: ProcessedDwellRow[] = [];
  for (const t1 of transitions) {
    if (EXCLUDED.includes(t1.to_status)) continue;
    const candidates = (transByIssue.get(t1.issue_id) ?? [])
      .filter(t2 => t2.from_status === t1.to_status && t2.transitioned_at > t1.transitioned_at);
    if (candidates.length === 0) continue; // exited_at IS NULL -> excluded
    const exited_at = candidates.reduce(
      (min, t2) => (t2.transitioned_at < min ? t2.transitioned_at : min),
      candidates[0].transitioned_at,
    );
    if (exited_at < from) continue; // exited_at >= from
    const issue = issueById.get(t1.issue_id);
    if (!issue) continue; // INNER JOIN issues

    const dwell_days = (new Date(exited_at).getTime() - new Date(t1.transitioned_at).getTime()) / MS_PER_DAY;
    if (dwell_days <= 0) continue;
    rows.push({
      issue_id: t1.issue_id,
      status: t1.to_status,
      entered_at: t1.transitioned_at,
      talla: issue.talla,
      dwell_days,
    });
  }
  return rows;
}

// Mirrors getCurrentIssues: issues not in an excluded status, with last_entry = the
// latest transition into the issue's current status (NULL if none — LEFT JOIN + MAX).
function computeCurrentIssues(
  issues: CoreIssueWithTitle[],
  transitions: CoreTransition[],
): CurrentIssueRow[] {
  const transByIssue = new Map<string, CoreTransition[]>();
  for (const t of transitions) {
    if (!transByIssue.has(t.issue_id)) transByIssue.set(t.issue_id, []);
    transByIssue.get(t.issue_id)!.push(t);
  }

  const rows: CurrentIssueRow[] = [];
  for (const i of issues) {
    if (EXCLUDED.includes(i.status)) continue;
    const matching = (transByIssue.get(i.id) ?? []).filter(t => t.to_status === i.status);
    const last_entry = matching.length > 0
      ? matching.reduce((max, t) => (t.transitioned_at > max ? t.transitioned_at : max), matching[0].transitioned_at)
      : null;
    rows.push({ issue_id: i.id, title: i.title, talla: i.talla, status: i.status, last_entry });
  }
  return rows;
}

function assignScores(combined: number[]): BottleneckScore[] {
  const n = combined.length;
  if (n === 0) return [];
  if (n === 1) return ['normal'];
  const indices = combined.map((_, i) => i).sort((a, b) => combined[b] - combined[a]);
  const scores = new Array<BottleneckScore>(n);
  indices.forEach((origIdx, rank) => {
    const q = rank / n;
    scores[origIdx] = q < 0.25 ? 'crítico' : q < 0.5 ? 'alto' : q < 0.75 ? 'medio' : 'normal';
  });
  return scores;
}

export function computeBottleneck(
  allIssues: CoreIssueWithTitle[],
  allTransitions: CoreTransition[],
  opts: { now?: Date; assignee?: string | null } = {},
): BottleneckResult {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  // Filtro por persona (parity: sin assignee => sin filtro, comportamiento idéntico).
  const ids = opts.assignee
    ? new Set(allIssues.filter(i => i.assignee_id === opts.assignee).map(i => i.id))
    : null;
  const issues = ids ? allIssues.filter(i => ids.has(i.id)) : allIssues;
  const transitions = ids ? allTransitions.filter(t => ids.has(t.issue_id)) : allTransitions;
  const from = new Date(nowMs - LOOKBACK_DAYS * MS_PER_DAY).toISOString();

  const currentIssues = computeCurrentIssues(issues, transitions);
  const total_active = currentIssues.length;
  if (total_active === 0) return { lookbackWeeks: LOOKBACK_WEEKS, total_active: 0, states: [] };

  const dwellRows = computeDwellRows(issues, transitions, from);

  // Group by status
  const issuesByStatus = new Map<string, CurrentIssueRow[]>();
  for (const iss of currentIssues) {
    if (!issuesByStatus.has(iss.status)) issuesByStatus.set(iss.status, []);
    issuesByStatus.get(iss.status)!.push(iss);
  }

  const dwellByStatus = new Map<string, ProcessedDwellRow[]>();
  for (const row of dwellRows) {
    if (!dwellByStatus.has(row.status)) dwellByStatus.set(row.status, []);
    dwellByStatus.get(row.status)!.push(row);
  }

  const statuses = [...issuesByStatus.keys()].sort();

  // Per-state avg/p85 (needed for score computation)
  const perState = statuses.map(status => {
    const dwells = (dwellByStatus.get(status) ?? []).map(d => d.dwell_days);
    const sorted = [...dwells].sort((a, b) => a - b);
    const avg_days = sorted.length >= MIN_SAMPLES_FOR_AVG
      ? sorted.reduce((s, v) => s + v, 0) / sorted.length
      : null;
    const p85_days = sorted.length >= MIN_SAMPLES_FOR_AVG
      ? percentile(sorted, 85)
      : null;
    return { status, queue_size: issuesByStatus.get(status)!.length, avg_days, p85_days };
  });

  // Score
  const maxQ = Math.max(...perState.map(p => p.queue_size), 1);
  const validAvgs = perState.map(p => p.avg_days).filter((v): v is number => v !== null);
  const maxT = validAvgs.length > 0 ? Math.max(...validAvgs, 0.001) : null;
  const combined = perState.map(p => {
    const qNorm = p.queue_size / maxQ;
    const tNorm = p.avg_days !== null && maxT !== null ? p.avg_days / maxT : qNorm;
    return 0.5 * qNorm + 0.5 * tNorm;
  });
  const scores = assignScores(combined);

  // Build full state objects
  const states: BottleneckState[] = perState.map(({ status, queue_size, avg_days, p85_days }, i) => {
    const score = scores[i];
    const issues = issuesByStatus.get(status)!;
    const dwells = dwellByStatus.get(status) ?? [];

    // top_issues
    const top_issues: BottleneckTopIssue[] = issues
      .map(iss => ({
        issue_id: iss.issue_id,
        title: iss.title,
        talla: iss.talla,
        days_in_state: iss.last_entry
          ? (nowMs - new Date(iss.last_entry).getTime()) / MS_PER_DAY
          : 0,
      }))
      .sort((a, b) => b.days_in_state - a.days_in_state)
      .slice(0, TOP_ISSUES_LIMIT);

    // trend
    const weekMap = new Map<string, number[]>();
    for (const d of dwells) {
      const week = isoMonday(d.entered_at);
      if (!weekMap.has(week)) weekMap.set(week, []);
      weekMap.get(week)!.push(d.dwell_days);
    }
    const trend: BottleneckWeekPoint[] = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-LOOKBACK_WEEKS)
      .map(([week, vals]) => ({
        week,
        avg_days: vals.reduce((s, v) => s + v, 0) / vals.length,
      }));

    const trend_pct =
      trend.length >= 2
        ? ((trend[trend.length - 1].avg_days - trend[0].avg_days) /
            Math.max(trend[0].avg_days, 0.001)) *
          100
        : null;

    // by_talla
    const tallaMap = new Map<Talla, number[]>();
    for (const d of dwells) {
      if (!d.talla) continue;
      if (!tallaMap.has(d.talla)) tallaMap.set(d.talla, []);
      tallaMap.get(d.talla)!.push(d.dwell_days);
    }
    const by_talla: BottleneckTallaBreakdown[] = TALLAS.filter(t => tallaMap.has(t)).map(t => {
      const vals = tallaMap.get(t)!;
      return { talla: t, avg_days: vals.reduce((s, v) => s + v, 0) / vals.length, count: vals.length };
    });

    const detail: BottleneckStateDetail = {
      p85_days,
      pct_of_wip: total_active > 0 ? queue_size / total_active : 0,
      trend_pct,
      trend,
      top_issues,
      by_talla,
    };

    return { status, queue_size, avg_days, score, detail };
  });

  // Sort severity desc, then queue_size desc
  states.sort((a, b) => {
    const sd = SEVERITY[b.score] - SEVERITY[a.score];
    return sd !== 0 ? sd : b.queue_size - a.queue_size;
  });

  return { lookbackWeeks: LOOKBACK_WEEKS, total_active, states };
}
