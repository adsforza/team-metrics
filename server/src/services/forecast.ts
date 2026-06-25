import Database from 'better-sqlite3';
import { percentile } from './stats';
import { DONE_STATUSES } from './statusCategories';
import type {
  ForecastBin, ForecastWhen, ForecastHowMany, ForecastResult, ForecastConfidenceDate,
} from '../types';

const LOOKBACK_DAYS = 84;
const TRIALS = 10000;
const MAX_SIM_DAYS = 730;
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
