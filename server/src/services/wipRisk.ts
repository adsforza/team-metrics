// server/src/services/wipRisk.ts
import Database from 'better-sqlite3';
import { percentile } from '../../../shared/core/stats';
import { getCycleTimes } from './metrics';
import { ACTIVE_STATUSES, STATUS_CATEGORIES } from '../../../shared/core/statusCategories';
import type { Talla, TallaLimit, WipRiskItem, WipRiskResult, WipRiskLevel } from '../types';

const LOOKBACK_DAYS = 84;
const MIN_SAMPLES = 5;
const RISK_RATIO = 0.7;
const BREACH_RATIO = 1.0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];
const NOT_DONE = [...STATUS_CATEGORIES.done, ...STATUS_CATEGORIES.cancelled];
const activeIn = ACTIVE_STATUSES.map(() => '?').join(',');
const notDoneIn = NOT_DONE.map(() => '?').join(',');

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function tallaLimits(db: Database.Database, now: Date): TallaLimit[] {
  const to = isoDate(now);
  const from = isoDate(new Date(now.getTime() - (LOOKBACK_DAYS - 1) * MS_PER_DAY));
  return TALLAS.map(talla => {
    const cts = getCycleTimes(db, { talla, from, to }); // already sorted ascending
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

function activeIssues(db: Database.Database): ActiveRow[] {
  return db.prepare(`
    SELECT i.id AS issue_id, i.title AS title, i.talla AS talla,
           i.status AS status, i.assignee_id AS assignee_id,
           MIN(t.transitioned_at) AS start_at
    FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status IN (${activeIn})
    WHERE i.status NOT IN (${notDoneIn})
    GROUP BY i.id
  `).all(...ACTIVE_STATUSES, ...NOT_DONE) as ActiveRow[];
}

export function getWipRisk(db: Database.Database, opts: { now?: Date } = {}): WipRiskResult {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const limits = tallaLimits(db, now);
  const limitByTalla = new Map(limits.map(l => [l.talla, l.limit_days]));

  const items: WipRiskItem[] = [];
  let sin_limite = 0;

  for (const r of activeIssues(db)) {
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
