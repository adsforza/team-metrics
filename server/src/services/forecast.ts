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

function pick(daily: number[], rng: () => number): number {
  return daily[Math.floor(rng() * daily.length)];
}

export function simulateHowMany(daily: number[], horizon: number, trials: number, rng: () => number): number[] {
  const out = new Array<number>(trials);
  for (let t = 0; t < trials; t++) {
    let sum = 0;
    for (let d = 0; d < horizon; d++) sum += pick(daily, rng);
    out[t] = sum;
  }
  return out.sort((a, b) => a - b);
}

export function simulateWhen(daily: number[], items: number, trials: number, rng: () => number, maxDays = MAX_SIM_DAYS): number[] {
  const out = new Array<number>(trials);
  for (let t = 0; t < trials; t++) {
    let done = 0, days = 0;
    while (done < items && days < maxDays) { done += pick(daily, rng); days++; }
    out[t] = days;
  }
  return out.sort((a, b) => a - b);
}

// ~20 equal-width bins over the central 90% (p5..p95) of a sorted sample array.
export function histogram(sortedSamples: number[], bins = 20): ForecastBin[] {
  const lo = percentile(sortedSamples, 5)!;
  const hi = percentile(sortedSamples, 95)!;
  if (hi <= lo) return [{ x: Math.round(lo), count: sortedSamples.length }];
  const width = (hi - lo) / bins;
  const out: ForecastBin[] = [];
  for (let i = 0; i < bins; i++) {
    const binLo = lo + i * width;
    const binHi = binLo + width;
    let count = 0;
    for (const s of sortedSamples) {
      if (s >= binLo && (i === bins - 1 ? s <= binHi : s < binHi)) count++;
    }
    out.push({ x: Math.round(binLo + width / 2), count });
  }
  return out;
}
