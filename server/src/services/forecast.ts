import Database from 'better-sqlite3';
import { percentile } from '../../../shared/core/stats';
import { DONE_STATUSES, STATUS_CATEGORIES } from '../../../shared/core/statusCategories';
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

// Bins over the central 90% (p5..p95) of a sorted sample array.
// When the integer range fits in ≤20 buckets, uses one bin per integer value
// to avoid duplicate x labels and empty bars on small ranges (e.g. 1–4 days).
export function histogram(sortedSamples: number[], bins = 20): ForecastBin[] {
  const lo = percentile(sortedSamples, 5)!;
  const hi = percentile(sortedSamples, 95)!;
  if (hi <= lo) return [{ x: Math.round(lo), count: sortedSamples.length }];
  const loInt = Math.round(lo);
  const hiInt = Math.round(hi);
  if (hiInt - loInt <= bins) {
    const out: ForecastBin[] = [];
    for (let v = loInt; v <= hiInt; v++) {
      out.push({ x: v, count: sortedSamples.filter(s => Math.round(s) === v).length });
    }
    return out;
  }
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

// WIP = anything not done, not cancelled, not still in the backlog/to-do.
// Derived from the canonical taxonomy so it can't drift from statusCategories.ts.
const WIP_EXCLUDED = [...STATUS_CATEGORIES.done, ...STATUS_CATEGORIES.cancelled, ...STATUS_CATEGORIES.todo];
const wipIn = WIP_EXCLUDED.map(() => '?').join(',');

function currentWip(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM issues WHERE status NOT IN (${wipIn})`).get(...WIP_EXCLUDED) as { c: number };
  return row.c;
}

function resolveItems(raw: unknown, wip: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return Math.max(1, Math.min(1000, wip || 1)); // no/invalid items param → default to current WIP, floored at 1 (a 0-WIP board forecasts 1 item)
  return Math.min(1000, n);
}

function resolveHorizon(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(365, n);
}

function dayConf(sorted: number[], p: number, asOf: Date): ForecastConfidenceDate {
  const days = Math.ceil(percentile(sorted, p)!);
  const baseMidnight = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const date = new Date(baseMidnight + days * MS_PER_DAY).toISOString().slice(0, 10);
  return { days, date };
}

export interface ForecastOpts { items?: unknown; horizon?: unknown; rng?: () => number; asOf?: Date }

export function getForecast(db: Database.Database, opts: ForecastOpts = {}): ForecastResult {
  const rng = opts.rng ?? Math.random;
  const asOf = opts.asOf ?? new Date();
  const daily = dailyThroughput(db, LOOKBACK_DAYS, asOf);
  const totalThroughput = daily.reduce((a, b) => a + b, 0);
  const items = resolveItems(opts.items, currentWip(db));
  const horizonDays = resolveHorizon(opts.horizon);

  const base = { items, horizonDays, lookbackDays: LOOKBACK_DAYS, trials: TRIALS, totalThroughput };
  if (totalThroughput === 0) return { ...base, insufficientData: true, when: null, howMany: null };

  const whenS = simulateWhen(daily, items, TRIALS, rng);
  const when: ForecastWhen = {
    conf50: dayConf(whenS, 50, asOf),
    conf85: dayConf(whenS, 85, asOf),
    conf95: dayConf(whenS, 95, asOf),
    histogram: histogram(whenS),
  };

  const hmS = simulateHowMany(daily, horizonDays, TRIALS, rng);
  // "At least N with C% confidence" maps to the LOWER tail of the completion distribution:
  // 85% confidence → 15th percentile, 95% confidence → 5th percentile.
  const howMany: ForecastHowMany = {
    conf50: Math.floor(percentile(hmS, 50)!),
    conf85: Math.floor(percentile(hmS, 15)!),
    conf95: Math.floor(percentile(hmS, 5)!),
    histogram: histogram(hmS),
  };

  return { ...base, insufficientData: false, when, howMany };
}
