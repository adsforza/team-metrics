// shared/core/wipRisk.ts
// Pure, in-memory port of server/src/services/wipRisk.ts (getWipRisk).
// SQL data access (tallaLimits' getCycleTimes query, activeIssues' JOIN/GROUP BY) is
// replaced by equivalents over plain arrays; every other bit of logic (p85 limit
// derivation, age computation from first active entry, ratio thresholds, sort) is
// transcribed unchanged, preserving exact status literals and string timestamp math.
import { percentile } from './stats';
import { computeCycleTimes } from './metrics';
import { ACTIVE_STATUSES, STATUS_CATEGORIES } from './statusCategories';
import type {
  Talla, TallaLimit, CoreIssueWithTitle, CoreTransition,
  WipRiskItem, WipRiskResult, WipRiskLevel,
} from './types';

const LOOKBACK_DAYS = 84;
const MIN_SAMPLES = 5;
const RISK_RATIO = 0.7;
const BREACH_RATIO = 1.0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];
const NOT_DONE = [...STATUS_CATEGORIES.done, ...STATUS_CATEGORIES.cancelled] as string[];

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function tallaLimits(issues: CoreIssueWithTitle[], transitions: CoreTransition[], now: Date): TallaLimit[] {
  const to = isoDate(now);
  const from = isoDate(new Date(now.getTime() - (LOOKBACK_DAYS - 1) * MS_PER_DAY));
  return TALLAS.map(talla => {
    const cts = computeCycleTimes(issues, transitions, { talla, from, to }); // already sorted ascending
    const sample_count = cts.length;
    let limit_days: number | null = null;
    if (sample_count >= MIN_SAMPLES) {
      const p85 = percentile(cts, 85);
      limit_days = p85 !== null && p85 > 0 ? p85 : null;
    }
    return { talla, limit_days, sample_count };
  });
}

interface ActiveRow {
  issue_id: string; title: string; talla: Talla | null;
  status: string; assignee_id: string | null; start_at: string;
}

// Mirrors: JOIN issues to transitions with to_status IN (ACTIVE_STATUSES) [INNER JOIN, so
// issues with no such transition are excluded entirely], WHERE status NOT IN (NOT_DONE),
// GROUP BY issue with start_at = MIN(transitioned_at) over the joined (active) rows.
function activeIssues(issues: CoreIssueWithTitle[], transitions: CoreTransition[]): ActiveRow[] {
  const transByIssue = new Map<string, CoreTransition[]>();
  for (const t of transitions) {
    if (!transByIssue.has(t.issue_id)) transByIssue.set(t.issue_id, []);
    transByIssue.get(t.issue_id)!.push(t);
  }

  const rows: ActiveRow[] = [];
  for (const i of issues) {
    if (NOT_DONE.includes(i.status)) continue;
    const activeAt = (transByIssue.get(i.id) ?? [])
      .filter(t => ACTIVE_STATUSES.includes(t.to_status))
      .map(t => t.transitioned_at);
    if (activeAt.length === 0) continue;
    const start_at = activeAt.reduce((a, b) => (a < b ? a : b));
    rows.push({
      issue_id: i.id, title: i.title, talla: i.talla,
      status: i.status, assignee_id: i.assignee_id, start_at,
    });
  }
  return rows;
}

export function computeWipRisk(
  issues: CoreIssueWithTitle[],
  transitions: CoreTransition[],
  opts: { now?: Date } = {},
): WipRiskResult {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const limits = tallaLimits(issues, transitions, now);
  const limitByTalla = new Map(limits.map(l => [l.talla, l.limit_days]));

  const items: WipRiskItem[] = [];
  let sin_limite = 0;

  for (const r of activeIssues(issues, transitions)) {
    const limit = r.talla ? limitByTalla.get(r.talla) ?? null : null;
    if (!r.talla || limit === null) { sin_limite++; continue; }
    const age_days = (nowMs - new Date(r.start_at).getTime()) / MS_PER_DAY;
    if (Number.isNaN(age_days)) { sin_limite++; continue; }
    const ratio = age_days / limit;
    if (ratio < RISK_RATIO) continue;
    const level: WipRiskLevel = ratio >= BREACH_RATIO ? 'excedido' : 'en_riesgo';
    items.push({
      issue_id: r.issue_id, title: r.title, talla: r.talla, status: r.status,
      assignee_id: r.assignee_id, age_days, limit_days: limit, ratio, level,
    });
  }

  items.sort((a, b) => b.ratio - a.ratio);
  const counts = {
    en_riesgo: items.filter(i => i.level === 'en_riesgo').length,
    excedido: items.filter(i => i.level === 'excedido').length,
    sin_limite,
  };
  return { lookbackDays: LOOKBACK_DAYS, limits, items, counts };
}
