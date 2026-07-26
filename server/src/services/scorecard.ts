// server/src/services/scorecard.ts
import Database from 'better-sqlite3';
import { percentile, median } from './stats';
import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories';
import type {
  Talla, FilterParams, DimensionValue, DimensionContext,
  ScorecardDimensions, PersonScorecard, TeamScorecardResponse, Trend, Improving,
} from '../types';

const TALLA_WEIGHT: Record<Talla, number> = { S: 1, M: 2, L: 4, XL: 8 };
const TREND_EPS = 0.05;          // ±5% relative change counts as "flat"
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MIN_CT_DAYS = 1 / 24;      // discard batch-moves < 1h (same rule as metrics.ts)

// ---- window helpers (dates are 'YYYY-MM-DD') -------------------------------

interface Window { from: string; to: string }

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function diffDaysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY) + 1;
}

export function resolveWindows(params: FilterParams): { cur: Window; prev: Window } {
  const to = params.to ?? isoDate(new Date());
  const from = params.from ?? addDays(to, -27);   // default current window = last 28 days
  const len = diffDaysInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo } };
}

function eachDay(w: Window): string[] {
  const days: string[] = [];
  let cursor = w.from;
  while (cursor <= w.to) { days.push(cursor); cursor = addDays(cursor, 1); }
  return days;
}

// ---- data access -----------------------------------------------------------

interface CompletedIssue { issue_id: string; talla: Talla | null; start_at: string; end_at: string }

const activeIn = ACTIVE_STATUSES.map(() => '?').join(',');
const doneIn = DONE_STATUSES.map(() => '?').join(',');

// Filters applied to the per-member / per-team queries. `assignee` (single) and `assignees`
// (a set, for the restricted team aggregate) are mutually exclusive; an empty `assignees`
// array means "no members" → matches nothing.
interface QueryFilter { assignee?: string; assignees?: string[]; tallas?: string[] }

function assigneeClause(f: QueryFilter): { sql: string; args: string[] } {
  if (f.assignee) return { sql: 'AND i.assignee_id = ?', args: [f.assignee] };
  if (f.assignees !== undefined) {
    if (f.assignees.length === 0) return { sql: 'AND 1 = 0', args: [] };
    return { sql: `AND i.assignee_id IN (${f.assignees.map(() => '?').join(',')})`, args: f.assignees };
  }
  return { sql: '', args: [] };
}

function tallaClause(f: QueryFilter): { sql: string; args: string[] } {
  if (f.tallas && f.tallas.length) return { sql: `AND i.talla IN (${f.tallas.map(() => '?').join(',')})`, args: f.tallas };
  return { sql: '', args: [] };
}

function completedIssues(db: Database.Database, w: Window, f: QueryFilter = {}): CompletedIssue[] {
  const asg = assigneeClause(f);
  const tal = tallaClause(f);
  const rows = db.prepare(`
    SELECT i.id AS issue_id, i.talla AS talla,
           MIN(t_start.transitioned_at) AS start_at,
           t_end.transitioned_at        AS end_at
    FROM issues i
    JOIN transitions t_start ON t_start.issue_id = i.id AND t_start.to_status IN (${activeIn})
    JOIN transitions t_end   ON t_end.issue_id   = i.id AND t_end.to_status   IN (${doneIn})
    WHERE t_end.transitioned_at >= ? AND t_end.transitioned_at <= ?
      ${asg.sql}
      ${tal.sql}
    GROUP BY i.id, t_end.transitioned_at
  `).all(
    ...ACTIVE_STATUSES, ...DONE_STATUSES,
    w.from + 'T00:00:00Z', w.to + 'T23:59:59Z',
    ...asg.args, ...tal.args,
  ) as any[];
  return rows.map(r => ({ issue_id: r.issue_id, talla: r.talla, start_at: r.start_at, end_at: r.end_at }));
}

function cycleDays(i: CompletedIssue): number {
  return (new Date(i.end_at).getTime() - new Date(i.start_at).getTime()) / MS_PER_DAY;
}

// Active-time ratio for one issue, using its full transition timeline clipped to [start,end].
function activeRatio(i: CompletedIssue, transitions: { to_status: string; transitioned_at: string }[]): number | null {
  const startMs = new Date(i.start_at).getTime();
  const endMs = new Date(i.end_at).getTime();
  const total = endMs - startMs;
  if (total <= 0) return null;
  const ordered = [...transitions].sort((a, b) => a.transitioned_at.localeCompare(b.transitioned_at));
  let activeMs = 0;
  for (let k = 0; k < ordered.length; k++) {
    const segStart = Math.max(new Date(ordered[k].transitioned_at).getTime(), startMs);
    const segEnd = Math.min(k + 1 < ordered.length ? new Date(ordered[k + 1].transitioned_at).getTime() : endMs, endMs);
    if (segEnd > segStart && categorize(ordered[k].to_status) === 'active') activeMs += segEnd - segStart;
  }
  return activeMs / total;
}

function transitionsByIssue(db: Database.Database, ids: string[]): Map<string, { to_status: string; transitioned_at: string }[]> {
  const map = new Map<string, { to_status: string; transitioned_at: string }[]>();
  if (ids.length === 0) return map;
  const rows = db.prepare(`
    SELECT issue_id, to_status, transitioned_at FROM transitions
    WHERE issue_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as any[];
  for (const r of rows) {
    if (!map.has(r.issue_id)) map.set(r.issue_id, []);
    map.get(r.issue_id)!.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
  }
  return map;
}

function activeWipAt(db: Database.Database, day: string, f: QueryFilter = {}): number {
  const at = day + 'T23:59:59Z';
  const asg = assigneeClause(f);
  const tal = tallaClause(f);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM issues i
    WHERE i.created_at <= ?
      ${asg.sql}
      ${tal.sql}
      AND COALESCE(
        (SELECT t.to_status FROM transitions t
         WHERE t.issue_id = i.id AND t.transitioned_at <= ?
         ORDER BY t.transitioned_at DESC LIMIT 1),
        i.status
      ) IN (${activeIn})
  `).get(at, ...asg.args, ...tal.args, at, ...ACTIVE_STATUSES) as any;
  return row.c;
}

// ---- regression & blocked helpers -----------------------------------------

// Flow rank derived from the canonical taxonomy in statusCategories.ts (single source of truth).
// Order: todo → active → waiting/committed → done. `blocked` and `unknown` are absent on purpose,
// so those transitions are ignored when scanning for backward moves.
const CATEGORY_RANK: Record<string, number> = { todo: 1, active: 2, waiting: 3, done: 4, cancelled: 4 };
function statusRank(status: string): number | undefined { return CATEGORY_RANK[categorize(status)]; }

function hasRegression(trans: { to_status: string; transitioned_at: string }[]): boolean {
  const ordered = trans
    .map(t => ({ rank: statusRank(t.to_status), at: t.transitioned_at }))
    .filter((t): t is { rank: number; at: string } => t.rank !== undefined)
    .sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1].rank;
    const curr = ordered[i].rank;
    if (curr < prev && prev >= 3) return true;
  }
  return false;
}

function wasBlocked(trans: { to_status: string }[]): boolean {
  return trans.some(t => t.to_status === 'Blocked');
}

// ---- the four dimensions ---------------------------------------------------

function delivery(db: Database.Database, w: Window, f: QueryFilter = {}): number {
  return completedIssues(db, w, f)
    .reduce((sum, i) => sum + (i.talla ? TALLA_WEIGHT[i.talla] : 0), 0);
}

function predictability(db: Database.Database, w: Window, f: QueryFilter = {}): number | null {
  const cts = completedIssues(db, w, f).map(cycleDays).filter(ct => ct >= MIN_CT_DAYS).sort((a, b) => a - b);
  if (cts.length < 2) return null;
  const p50 = percentile(cts, 50)!;
  const p85 = percentile(cts, 85)!;
  return p50 === 0 ? null : p85 / p50;
}

function focus(db: Database.Database, w: Window, f: QueryFilter = {}): number {
  const days = eachDay(w);
  if (days.length === 0) return 0;
  return days.reduce((sum, d) => sum + activeWipAt(db, d, f), 0) / days.length;
}

// Intentional deviation from spec: the spec said "return null if < 2 completed issues" but flow
// efficiency is meaningful for a single issue (active time / total cycle time is well-defined with
// just one data point). We therefore return null only when there are ZERO completed issues.
// Predictability, by contrast, needs >= 2 to compute a spread (p85/p50), so it keeps the < 2 guard.
function flow(db: Database.Database, w: Window, f: QueryFilter = {}): number | null {
  const issues = completedIssues(db, w, f).filter(i => cycleDays(i) >= MIN_CT_DAYS);
  if (issues.length === 0) return null;
  const trans = transitionsByIssue(db, issues.map(i => i.issue_id));
  const ratios = issues
    .map(i => activeRatio(i, trans.get(i.issue_id) ?? []))
    .filter((r): r is number => r !== null);
  const m = median(ratios);
  return m === null ? null : m * 100;   // report as percentage
}

function regressions(db: Database.Database, w: Window, f: QueryFilter = {}): number | null {
  const issues = completedIssues(db, w, f);
  if (issues.length === 0) return null;
  const trans = transitionsByIssue(db, issues.map(i => i.issue_id));
  const count = issues.filter(i => hasRegression(trans.get(i.issue_id) ?? [])).length;
  return (count / issues.length) * 100;
}

function blocked(db: Database.Database, w: Window, f: QueryFilter = {}): number | null {
  const issues = completedIssues(db, w, f);
  if (issues.length === 0) return null;
  const trans = transitionsByIssue(db, issues.map(i => i.issue_id));
  const count = issues.filter(i => wasBlocked(trans.get(i.issue_id) ?? [])).length;
  return (count / issues.length) * 100;
}

// ---- trend / context assembly ----------------------------------------------

export function makeDimension(current: number | null, previous: number | null, lowerIsBetter: boolean): DimensionValue {
  let trend: Trend = 'flat';
  let improving: Improving = 'steady';
  if (current !== null && previous !== null) {
    if (previous === 0) {
      if (current !== 0) { trend = 'up'; improving = lowerIsBetter ? 'worse' : 'better'; }
    } else {
      const rel = (current - previous) / Math.abs(previous);
      if (Math.abs(rel) > TREND_EPS) {
        trend = rel > 0 ? 'up' : 'down';
        const better = lowerIsBetter ? rel < 0 : rel > 0;
        improving = better ? 'better' : 'worse';
      }
    }
  }
  return { value: current, previous, trend, improving };
}

function contextOf(values: (number | null)[]): DimensionContext {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return { min: 0, median: 0, max: 0 };
  return { min: Math.min(...nums), median: median(nums)!, max: Math.max(...nums) };
}

function dimensionsFor(db: Database.Database, cur: Window, prev: Window, f: QueryFilter = {}): ScorecardDimensions {
  return {
    delivery: makeDimension(delivery(db, cur, f), delivery(db, prev, f), false),
    predictability: makeDimension(predictability(db, cur, f), predictability(db, prev, f), true),
    focus: makeDimension(focus(db, cur, f), focus(db, prev, f), true),
    flow: makeDimension(flow(db, cur, f), flow(db, prev, f), false),
    regressions: makeDimension(regressions(db, cur, f), regressions(db, prev, f), true),
    blocked: makeDimension(blocked(db, cur, f), blocked(db, prev, f), true),
  };
}

// A member is shown only if it has data for all four indicators. In practice the binding
// constraint is predictability (needs >= 2 completed issues); flow needs >= 1. Members without
// complete data are excluded from the table, the context band, AND the team aggregate.
function hasAllData(c: ScorecardDimensions): boolean {
  return c.delivery.value !== null && c.predictability.value !== null
    && c.focus.value !== null && c.flow.value !== null;
}

export function getTeamScorecard(db: Database.Database, params: FilterParams): TeamScorecardResponse {
  const { cur, prev } = resolveWindows(params);
  const tallas = params.talla ? params.talla.split(',').map(t => t.trim()).filter(Boolean) : undefined;
  const members = db.prepare('SELECT * FROM team_members ORDER BY display_name').all() as any[];

  const memberCards: PersonScorecard[] = members
    .map(m => ({ member: m, ...dimensionsFor(db, cur, prev, { assignee: m.id, tallas }) }))
    .filter(hasAllData);

  // Team aggregate restricted to the included members only (empty set → matches nothing).
  const includedIds = memberCards.map(c => c.member.id);
  const team = dimensionsFor(db, cur, prev, { assignees: includedIds, tallas });

  const context = {
    delivery: contextOf(memberCards.map(c => c.delivery.value)),
    predictability: contextOf(memberCards.map(c => c.predictability.value)),
    focus: contextOf(memberCards.map(c => c.focus.value)),
    flow: contextOf(memberCards.map(c => c.flow.value)),
    regressions: contextOf(memberCards.map(c => c.regressions.value)),
    blocked: contextOf(memberCards.map(c => c.blocked.value)),
  };

  return { team, members: memberCards, context };
}
