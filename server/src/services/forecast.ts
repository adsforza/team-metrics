// server/src/services/forecast.ts
// Thin loader: reads issues/transitions from SQLite and delegates the Monte Carlo
// computation to shared/core/forecast.ts (computeForecast). See that file for the
// actual logic. `dailyThroughput` stays here (and DB-backed) because it's exercised
// directly, against a real SQLite db, by forecast.test.ts.
import Database from 'better-sqlite3';
import { computeForecast } from '../../../shared/core/forecast';
import { DONE_STATUSES } from '../../../shared/core/statusCategories';
import type { CoreIssue, CoreTransition } from '../../../shared/core/types';
import type { ForecastResult } from '../types';

export { simulateHowMany, simulateWhen, histogram } from '../../../shared/core/forecast';

const LOOKBACK_DAYS = 84;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const doneIn = DONE_STATUSES.map(() => '?').join(',');

// Day-bucketed completion counts over the last `lookbackDays` calendar days ending on `asOf`.
// Bucketing is done in JS (new Date) because Jira's -0300 offset breaks SQLite date().
export function dailyThroughput(db: Database.Database, lookbackDays = LOOKBACK_DAYS, asOf: Date = new Date()): number[] {
  const endMidnight = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const startMs = endMidnight - (lookbackDays - 1) * MS_PER_DAY;
  const rows = db.prepare(`SELECT transitioned_at AS at FROM transitions WHERE to_status IN (${doneIn})`)
    .all(...DONE_STATUSES) as { at: string }[];
  const buckets = new Array(lookbackDays).fill(0);
  for (const r of rows) {
    const ms = new Date(r.at).getTime();
    if (Number.isNaN(ms)) continue;
    const idx = Math.floor((ms - startMs) / MS_PER_DAY);
    if (idx >= 0 && idx < lookbackDays) buckets[idx]++;
  }
  return buckets;
}

export interface ForecastOpts { items?: unknown; horizon?: unknown; rng?: () => number; asOf?: Date; assignee?: string | null }

export function getForecast(db: Database.Database, opts: ForecastOpts = {}): ForecastResult {
  const issues = db.prepare(`
    SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues
  `).all() as CoreIssue[];
  const transitions = db.prepare(`
    SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
  `).all() as CoreTransition[];

  return computeForecast(issues, transitions, {
    items: opts.items, horizon: opts.horizon, rng: opts.rng, now: opts.asOf, assignee: opts.assignee,
  });
}
