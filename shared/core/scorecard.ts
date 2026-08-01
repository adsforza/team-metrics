// shared/core/scorecard.ts
// Pure, in-memory port of server/src/services/scorecard.ts (getTeamScorecard).
// The three SQL data-access functions (completedIssues, activeWipAt, transitionsByIssue) are
// replaced by equivalents over plain arrays; every other helper is transcribed unchanged.
import { percentile, median } from './stats';
import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories';
import type {
  Talla, CoreIssue, CoreTransition, CoreMember, FilterParams,
  DimensionValue, DimensionContext, ScorecardDimensions, PersonScorecard, TeamScorecardResponse,
  Trend, Improving,
} from './types';

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

export function resolveWindows(params: FilterParams, now: Date = new Date()): { cur: Window; prev: Window } {
  const to = params.to ?? isoDate(now);
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

// ---- data access (in-memory equivalents of the reference SQL) -------------

interface CompletedIssue { issue_id: string; talla: Talla | null; start_at: string; end_at: string }

// Filters applied to the per-member / per-team queries. `assignee` (single) and `assignees`
// (a set, for the restricted team aggregate) are mutually exclusive; an empty `assignees`
// array means "no members" → matches nothing.
interface QueryFilter { assignee?: string; assignees?: string[]; tallas?: string[] }

function passesAssignee(i: CoreIssue, f: QueryFilter): boolean {
  if (f.assignee) return i.assignee_id === f.assignee;
  if (f.assignees !== undefined) {
    if (f.assignees.length === 0) return false;
    return i.assignee_id != null && f.assignees.includes(i.assignee_id);
  }
  return true;
}

function passesTalla(i: CoreIssue, f: QueryFilter): boolean {
  if (f.tallas && f.tallas.length) return i.talla != null && f.tallas.includes(i.talla);
  return true;
}

function groupByIssue(transitions: CoreTransition[]): Map<string, CoreTransition[]> {
  const map = new Map<string, CoreTransition[]>();
  for (const t of transitions) {
    if (!map.has(t.issue_id)) map.set(t.issue_id, []);
    map.get(t.issue_id)!.push(t);
  }
  return map;
}

function completedIssues(
  issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {},
): CompletedIssue[] {
  const byIssue = groupByIssue(transitions);
  const fromAt = w.from + 'T00:00:00Z';
  const toAt = w.to + 'T23:59:59Z';
  const out: CompletedIssue[] = [];
  for (const i of issues) {
    if (!passesAssignee(i, f) || !passesTalla(i, f)) continue;
    const ts = byIssue.get(i.id) ?? [];
    const startTimes = ts.filter(t => ACTIVE_STATUSES.includes(t.to_status)).map(t => t.transitioned_at);
    if (startTimes.length === 0) continue; // mirrors the INNER JOIN on t_start
    const startAt = startTimes.reduce((a, b) => (a < b ? a : b));
    const ends = ts.filter(t => DONE_STATUSES.includes(t.to_status) && t.transitioned_at >= fromAt && t.transitioned_at <= toAt);
    // Mirrors `GROUP BY i.id, t_end.transitioned_at`: one row per distinct end timestamp.
    const seen = new Set<string>();
    for (const end of ends) {
      if (seen.has(end.transitioned_at)) continue;
      seen.add(end.transitioned_at);
      out.push({ issue_id: i.id, talla: i.talla, start_at: startAt, end_at: end.transitioned_at });
    }
  }
  return out;
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

function transitionsByIssue(transitions: CoreTransition[], ids: string[]): Map<string, { to_status: string; transitioned_at: string }[]> {
  const map = new Map<string, { to_status: string; transitioned_at: string }[]>();
  if (ids.length === 0) return map;
  const idSet = new Set(ids);
  for (const t of transitions) {
    if (!idSet.has(t.issue_id)) continue;
    if (!map.has(t.issue_id)) map.set(t.issue_id, []);
    map.get(t.issue_id)!.push({ to_status: t.to_status, transitioned_at: t.transitioned_at });
  }
  return map;
}

function activeWipAt(issues: CoreIssue[], transitions: CoreTransition[], day: string, f: QueryFilter = {}): number {
  const at = day + 'T23:59:59Z';
  const byIssue = groupByIssue(transitions);
  let count = 0;
  for (const i of issues) {
    if (i.created_at > at) continue;
    if (!passesAssignee(i, f) || !passesTalla(i, f)) continue;
    const ts = (byIssue.get(i.id) ?? []).filter(t => t.transitioned_at <= at);
    let status = i.status;
    if (ts.length > 0) {
      let latest = ts[0];
      for (const t of ts) if (t.transitioned_at > latest.transitioned_at) latest = t;
      status = latest.to_status;
    }
    if (ACTIVE_STATUSES.includes(status)) count++;
  }
  return count;
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

function delivery(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number {
  return completedIssues(issues, transitions, w, f)
    .reduce((sum, i) => sum + (i.talla ? TALLA_WEIGHT[i.talla] : 0), 0);
}

function predictability(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number | null {
  const cts = completedIssues(issues, transitions, w, f).map(cycleDays).filter(ct => ct >= MIN_CT_DAYS).sort((a, b) => a - b);
  if (cts.length < 2) return null;
  const p50 = percentile(cts, 50)!;
  const p85 = percentile(cts, 85)!;
  return p50 === 0 ? null : p85 / p50;
}

function focus(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number {
  const days = eachDay(w);
  if (days.length === 0) return 0;
  return days.reduce((sum, d) => sum + activeWipAt(issues, transitions, d, f), 0) / days.length;
}

// Intentional deviation from spec: the spec said "return null if < 2 completed issues" but flow
// efficiency is meaningful for a single issue (active time / total cycle time is well-defined with
// just one data point). We therefore return null only when there are ZERO completed issues.
// Predictability, by contrast, needs >= 2 to compute a spread (p85/p50), so it keeps the < 2 guard.
function flow(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number | null {
  const done = completedIssues(issues, transitions, w, f).filter(i => cycleDays(i) >= MIN_CT_DAYS);
  if (done.length === 0) return null;
  const trans = transitionsByIssue(transitions, done.map(i => i.issue_id));
  const ratios = done
    .map(i => activeRatio(i, trans.get(i.issue_id) ?? []))
    .filter((r): r is number => r !== null);
  const m = median(ratios);
  return m === null ? null : m * 100;   // report as percentage
}

function regressions(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number | null {
  const done = completedIssues(issues, transitions, w, f);
  if (done.length === 0) return null;
  const trans = transitionsByIssue(transitions, done.map(i => i.issue_id));
  const count = done.filter(i => hasRegression(trans.get(i.issue_id) ?? [])).length;
  return (count / done.length) * 100;
}

function blocked(issues: CoreIssue[], transitions: CoreTransition[], w: Window, f: QueryFilter = {}): number | null {
  const done = completedIssues(issues, transitions, w, f);
  if (done.length === 0) return null;
  const trans = transitionsByIssue(transitions, done.map(i => i.issue_id));
  const count = done.filter(i => wasBlocked(trans.get(i.issue_id) ?? [])).length;
  return (count / done.length) * 100;
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

function dimensionsFor(
  issues: CoreIssue[], transitions: CoreTransition[], cur: Window, prev: Window, f: QueryFilter = {},
): ScorecardDimensions {
  return {
    delivery: makeDimension(delivery(issues, transitions, cur, f), delivery(issues, transitions, prev, f), false),
    predictability: makeDimension(predictability(issues, transitions, cur, f), predictability(issues, transitions, prev, f), true),
    focus: makeDimension(focus(issues, transitions, cur, f), focus(issues, transitions, prev, f), true),
    flow: makeDimension(flow(issues, transitions, cur, f), flow(issues, transitions, prev, f), false),
    regressions: makeDimension(regressions(issues, transitions, cur, f), regressions(issues, transitions, prev, f), true),
    blocked: makeDimension(blocked(issues, transitions, cur, f), blocked(issues, transitions, prev, f), true),
  };
}

// A member is shown only if it has data for all four indicators. In practice the binding
// constraint is predictability (needs >= 2 completed issues); flow needs >= 1. Members without
// complete data are excluded from the table, the context band, AND the team aggregate.
function hasAllData(c: ScorecardDimensions): boolean {
  return c.delivery.value !== null && c.predictability.value !== null
    && c.focus.value !== null && c.flow.value !== null;
}

export function computeScorecard(
  issues: CoreIssue[], transitions: CoreTransition[], members: CoreMember[],
  params: FilterParams, now: Date = new Date(),
): TeamScorecardResponse {
  const { cur, prev } = resolveWindows(params, now);
  const tallas = params.talla ? params.talla.split(',').map(t => t.trim()).filter(Boolean) : undefined;
  const sortedMembers = [...members].sort((a, b) =>
    a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0);

  const memberCards: PersonScorecard[] = sortedMembers
    .map(m => ({ member: m, ...dimensionsFor(issues, transitions, cur, prev, { assignee: m.id, tallas }) }))
    .filter(hasAllData);

  // Team aggregate restricted to the included members only (empty set → matches nothing).
  const includedIds = memberCards.map(c => c.member.id);
  const team = dimensionsFor(issues, transitions, cur, prev, { assignees: includedIds, tallas });

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
