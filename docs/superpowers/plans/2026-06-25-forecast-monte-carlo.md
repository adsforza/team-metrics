# Forecast (Monte Carlo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Monte Carlo forecast — "when will N items finish?" and "how many finish in D days?" — driven by the team's last-12-weeks daily throughput, surfaced as 50/85/95% confidence results plus a distribution histogram.

**Architecture:** A self-contained server module `forecast.ts` reconstructs daily throughput from `transitions`, runs 10k-trial simulations, and returns a `ForecastResult` via `GET /api/metrics/forecast`. The client has a presentational `ForecastCard` (tested with fixtures) wrapped by a `Forecast` container that wires the `useForecast` hook (debounced input → API).

**Tech Stack:** Node 20 + TypeScript + better-sqlite3 + Express (server); Vite + React 18 + TS + Tailwind + Recharts 2.12 (client). Tests: Vitest (+ supertest, @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-06-25-forecast-monte-carlo-design.md`

---

## File Structure

**Create:**
- `server/src/services/forecast.ts` — daily throughput, simulations, histogram, `getForecast`.
- `server/src/services/forecast.test.ts`.
- `client/src/hooks/useForecast.ts` — mode/items/horizon state, debounced fetch.
- `client/src/components/Forecast/ForecastCard.tsx` — presentational card (props-driven).
- `client/src/components/Forecast/ForecastHistogram.tsx` — Recharts distribution chart.
- `client/src/components/Forecast/Forecast.tsx` — container (hook + card).
- `client/src/components/Forecast/ForecastCard.test.tsx`.

**Modify:**
- `server/src/types.ts` — add forecast types.
- `server/src/routes/metrics.ts` — add `/forecast` route.
- `server/src/routes/routes.test.ts` — add `/api/metrics/forecast` shape test.
- `client/src/lib/api.ts` — export forecast types + `api.forecast`.
- `client/src/App.tsx` — mount `<Forecast />`.

---

## Task 1: Forecast types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Append the types**

Add to the end of `server/src/types.ts`:

```ts
export interface ForecastConfidenceDate { days: number; date: string }
export interface ForecastBin { x: number; count: number }

export interface ForecastWhen {
  conf50: ForecastConfidenceDate;
  conf85: ForecastConfidenceDate;
  conf95: ForecastConfidenceDate;
  histogram: ForecastBin[];
}

export interface ForecastHowMany {
  conf50: number;  // items (>=)
  conf85: number;
  conf95: number;
  histogram: ForecastBin[];
}

export interface ForecastResult {
  items: number;            // item count used for the "when" forecast (echo; default = current WIP)
  horizonDays: number;      // horizon used for the "how many" forecast (echo; default 14)
  lookbackDays: number;     // 84
  trials: number;           // 10000
  totalThroughput: number;  // total completed in the lookback window
  insufficientData: boolean;
  when: ForecastWhen | null;
  howMany: ForecastHowMany | null;
}
```

- [ ] **Step 2: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): Monte Carlo forecast result types"
```

---

## Task 2: Daily throughput helper

**Files:**
- Create: `server/src/services/forecast.ts`
- Test: `server/src/services/forecast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/forecast.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { dailyThroughput } from './forecast';

function seedDone(db: Database.Database, id: string, doneAt: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `I ${id}`, '', 'Done', null, 'M', 0.9, '2026-01-01T00:00:00Z', doneAt, '2026-06-25T00:00:00Z', doneAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'In Progress', 'Done', doneAt);
}

describe('dailyThroughput', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applySchema(db); });

  it('buckets completions into the correct day within the lookback window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    // Two done on 2026-06-24, one on 2026-06-25 (incl. a -0300 offset timestamp)
    seedDone(db, 'A-1', '2026-06-24T10:00:00Z');
    seedDone(db, 'A-2', '2026-06-24T20:00:00-0300');
    seedDone(db, 'A-3', '2026-06-25T09:00:00Z');
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily).toHaveLength(84);
    expect(daily[83]).toBe(1); // today (2026-06-25)
    expect(daily[82]).toBe(2); // yesterday (2026-06-24)
    expect(daily.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('ignores completions outside the window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    seedDone(db, 'OLD', '2026-01-01T10:00:00Z'); // far outside 84-day window
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: FAIL — cannot find module `./forecast`.

- [ ] **Step 3: Implement the helper**

```ts
// server/src/services/forecast.ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/forecast.ts server/src/services/forecast.test.ts
git commit -m "feat(server): daily throughput helper for forecasting"
```

---

## Task 3: Simulation core + histogram

**Files:**
- Modify: `server/src/services/forecast.ts`
- Modify: `server/src/services/forecast.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/forecast.test.ts`:

```ts
import { simulateWhen, simulateHowMany, histogram } from './forecast';

describe('simulateHowMany', () => {
  it('with a constant 1/day history, completes exactly `horizon` items', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateHowMany(daily, 10, 2000, Math.random);
    expect(samples).toHaveLength(2000);
    expect(samples.every(s => s === 10)).toBe(true); // every day contributes exactly 1
  });
});

describe('simulateWhen', () => {
  it('with a constant 1/day history, needs exactly `items` days', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateWhen(daily, 7, 2000, Math.random);
    expect(samples.every(s => s === 7)).toBe(true);
  });

  it('returns a sorted ascending array', () => {
    const daily = [0, 1, 2, 0, 3, 1]; // variable
    const samples = simulateWhen(daily, 5, 1000, Math.random);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });
});

describe('histogram', () => {
  it('returns a single bin when the range is degenerate', () => {
    const bins = histogram(new Array(100).fill(5));
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ x: 5, count: 100 });
  });

  it('partitions samples into ~20 bins covering the central 90%', () => {
    const sorted = Array.from({ length: 1000 }, (_, i) => i).sort((a, b) => a - b); // 0..999
    const bins = histogram(sorted);
    expect(bins.length).toBe(20);
    const total = bins.reduce((a, b) => a + b.count, 0);
    // central 90% → roughly 900 samples land in the [p5,p95] bins
    expect(total).toBeGreaterThan(850);
    expect(total).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: FAIL — `simulateWhen`/`simulateHowMany`/`histogram` not exported.

- [ ] **Step 3: Implement**

Append to `server/src/services/forecast.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/forecast.ts server/src/services/forecast.test.ts
git commit -m "feat(server): Monte Carlo simulations + histogram binning"
```

---

## Task 4: getForecast assembly

**Files:**
- Modify: `server/src/services/forecast.ts`
- Modify: `server/src/services/forecast.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/forecast.test.ts`:

```ts
import { getForecast } from './forecast';

function seedActive(db: Database.Database, id: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `I ${id}`, '', 'In Progress', null, 'M', 0.9, '2026-06-01T00:00:00Z', '2026-06-20T00:00:00Z', '2026-06-25T00:00:00Z', '2026-06-20T00:00:00Z',
  );
}

describe('getForecast', () => {
  let db: Database.Database;
  const asOf = new Date('2026-06-25T12:00:00Z');
  beforeEach(() => { db = new Database(':memory:'); applySchema(db); });

  it('flags insufficient data when nothing completed in the window', () => {
    seedActive(db, 'W-1');
    const f = getForecast(db, { asOf });
    expect(f.insufficientData).toBe(true);
    expect(f.when).toBeNull();
    expect(f.howMany).toBeNull();
  });

  it('defaults `items` to the current WIP count', () => {
    seedActive(db, 'W-1');
    seedActive(db, 'W-2');
    seedDone(db, 'D-1', '2026-06-24T10:00:00Z'); // gives non-zero throughput
    const f = getForecast(db, { asOf });
    expect(f.items).toBe(2);          // two active issues
    expect(f.insufficientData).toBe(false);
  });

  it('wires confidence levels to the correct tails', () => {
    // variable throughput so percentiles differ
    for (let d = 0; d < 30; d++) seedDone(db, `X-${d}`, `2026-06-${String((d % 25) + 1).padStart(2, '0')}T10:00:00Z`);
    const f = getForecast(db, { items: 20, horizon: 14, asOf });
    // "when": safer confidence = later (more days)
    expect(f.when!.conf95.days).toBeGreaterThanOrEqual(f.when!.conf85.days);
    expect(f.when!.conf85.days).toBeGreaterThanOrEqual(f.when!.conf50.days);
    // "how many": safer confidence = fewer items
    expect(f.howMany!.conf95).toBeLessThanOrEqual(f.howMany!.conf85);
    expect(f.howMany!.conf85).toBeLessThanOrEqual(f.howMany!.conf50);
    // dates are derived from asOf + days
    expect(f.when!.conf50.date).toBe(new Date(asOf.getTime() + f.when!.conf50.days * 24 * 3600 * 1000).toISOString().slice(0, 10));
  });

  it('clamps out-of-range inputs and echoes the values used', () => {
    seedDone(db, 'D-1', '2026-06-24T10:00:00Z');
    expect(getForecast(db, { items: 99999, asOf }).items).toBe(1000);
    expect(getForecast(db, { horizon: 9999, asOf }).horizonDays).toBe(365);
    expect(getForecast(db, { horizon: 0, asOf }).horizonDays).toBe(14);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: FAIL — `getForecast` not exported.

- [ ] **Step 3: Implement**

Append to `server/src/services/forecast.ts`:

```ts
const WIP_EXCLUDED = ['Done', 'Finalizada', 'Cancelled', 'Cancelado', 'To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'];
const wipIn = WIP_EXCLUDED.map(() => '?').join(',');

function currentWip(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM issues WHERE status NOT IN (${wipIn})`).get(...WIP_EXCLUDED) as { c: number };
  return row.c;
}

function resolveItems(raw: unknown, wip: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return Math.max(1, Math.min(1000, wip || 1));
  return Math.min(1000, n);
}

function resolveHorizon(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(365, n);
}

function dayConf(sorted: number[], p: number, asOf: Date): ForecastConfidenceDate {
  const days = Math.ceil(percentile(sorted, p)!);
  const date = new Date(asOf.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
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
  const howMany: ForecastHowMany = {
    conf50: Math.floor(percentile(hmS, 50)!),  // typical
    conf85: Math.floor(percentile(hmS, 15)!),  // 85% chance of at least this many
    conf95: Math.floor(percentile(hmS, 5)!),   // 95% chance of at least this many
    histogram: histogram(hmS),
  };

  return { ...base, insufficientData: false, when, howMany };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/services/forecast.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/forecast.ts server/src/services/forecast.test.ts
git commit -m "feat(server): getForecast — WIP default, clamps, confidence wiring"
```

---

## Task 5: Route + route test

**Files:**
- Modify: `server/src/routes/metrics.ts`
- Modify: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` to `server/src/routes/routes.test.ts`:

```ts
describe('GET /api/metrics/forecast', () => {
  it('returns 200 with the forecast shape', async () => {
    const res = await request(app).get('/api/metrics/forecast');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('horizonDays');
    expect(res.body).toHaveProperty('insufficientData');
    expect(res.body).toHaveProperty('lookbackDays', 84);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Add the route**

In `server/src/routes/metrics.ts`, add the import and a new route (place the route after the existing `/aging` route, before `export default router`):

```ts
import { getForecast } from '../services/forecast';
```
```ts
router.get('/forecast', (req, res, next) => {
  try {
    res.json(getForecast(getDb(), { items: req.query.items, horizon: req.query.horizon }));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 5: Type-check + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/routes/metrics.ts server/src/routes/routes.test.ts
git commit -m "feat(server): GET /api/metrics/forecast route"
```

---

## Task 6: Client API types + method

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add types and method**

In `client/src/lib/api.ts`:
- Add `ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin` to BOTH the `import type { ... }` and the `export type { ... }` lines (keep all existing names).
- Add this method inside the `api` object (next to `metricsAging`):

```ts
  forecast: (p: Record<string, string | undefined> = {}) => get<ForecastResult>('/metrics/forecast', p),
```

- [ ] **Step 2: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(client): forecast API types + method"
```

---

## Task 7: useForecast hook

**Files:**
- Create: `client/src/hooks/useForecast.ts`

- [ ] **Step 1: Implement the hook**

```ts
// client/src/hooks/useForecast.ts
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ForecastResult } from '../lib/api';

export type ForecastMode = 'when' | 'howMany';

export function useForecast() {
  const [mode, setMode] = useState<ForecastMode>('when');
  const [items, setItems] = useState<number | undefined>(undefined); // undefined → server fills WIP default
  const [horizon, setHorizon] = useState<number>(14);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const adopted = useRef(false);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api.forecast({
        items: items !== undefined ? String(items) : undefined,
        horizon: String(horizon),
      })
        .then(f => {
          setForecast(f);
          // adopt the server-provided WIP default into the input on first load
          if (!adopted.current && items === undefined) { adopted.current = true; setItems(f.items); }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [items, horizon]);

  return { mode, setMode, items, setItems, horizon, setHorizon, forecast, loading };
}
```

- [ ] **Step 2: Type-check + commit**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

```bash
git add client/src/hooks/useForecast.ts
git commit -m "feat(client): useForecast hook (debounced, WIP default)"
```

---

## Task 8: ForecastHistogram component

**Files:**
- Create: `client/src/components/Forecast/ForecastHistogram.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/Forecast/ForecastHistogram.tsx
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { ForecastBin } from '../../lib/api';

interface Mark { x: number; label: string }

interface Props {
  bins: ForecastBin[];
  marks: Mark[];
  unit: string; // e.g. 'días' or 'issues'
}

export function ForecastHistogram({ bins, marks, unit }: Props) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={bins} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="x"
          type="number"
          domain={['dataMin', 'dataMax']}
          tick={{ fontSize: 10, fill: '#64748b' }}
          label={{ value: unit, fontSize: 9, fill: '#475569', position: 'insideBottomRight', offset: -2 }}
        />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={28} />
        <Bar dataKey="count" fill="#3b82f6" fillOpacity={0.55} isAnimationActive={false} />
        {marks.map(m => (
          <ReferenceLine
            key={m.label}
            x={m.x}
            stroke="#cbd5e1"
            strokeDasharray="3 3"
            label={{ value: m.label, fontSize: 9, fill: '#94a3b8', position: 'top' }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

```bash
git add client/src/components/Forecast/ForecastHistogram.tsx
git commit -m "feat(client): ForecastHistogram distribution chart"
```

---

## Task 9: ForecastCard (presentational) + test

**Files:**
- Create: `client/src/components/Forecast/ForecastCard.tsx`
- Test: `client/src/components/Forecast/ForecastCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Forecast/ForecastCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastCard } from './ForecastCard';
import type { ForecastResult } from '../../lib/api';

// ForecastHistogram renders an SVG via ResponsiveContainer (0x0 in jsdom); stub it out.
vi.mock('./ForecastHistogram', () => ({ ForecastHistogram: () => <div data-testid="histogram" /> }));

const result: ForecastResult = {
  items: 23, horizonDays: 14, lookbackDays: 84, trials: 10000, totalThroughput: 120,
  insufficientData: false,
  when: {
    conf50: { days: 8, date: '2026-07-03' },
    conf85: { days: 17, date: '2026-07-12' },
    conf95: { days: 23, date: '2026-07-18' },
    histogram: [{ x: 8, count: 100 }],
  },
  howMany: { conf50: 12, conf85: 8, conf95: 6, histogram: [{ x: 12, count: 100 }] },
};

const noop = () => {};
const baseProps = {
  forecast: result, loading: false,
  items: 23, setItems: noop, horizon: 14, setHorizon: noop,
};

describe('ForecastCard', () => {
  it('shows delivery dates in "when" mode', () => {
    render(<ForecastCard {...baseProps} mode="when" setMode={noop} />);
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
    expect(screen.getByText(/17 días/)).toBeInTheDocument();
  });

  it('shows item counts in "how many" mode', () => {
    render(<ForecastCard {...baseProps} mode="howMany" setMode={noop} />);
    expect(screen.getByText(/≥\s*8/)).toBeInTheDocument();
  });

  it('calls setMode when the other toggle is clicked', () => {
    const setMode = vi.fn();
    render(<ForecastCard {...baseProps} mode="when" setMode={setMode} />);
    fireEvent.click(screen.getByRole('button', { name: /Cuántos/ }));
    expect(setMode).toHaveBeenCalledWith('howMany');
  });

  it('shows an insufficient-data message', () => {
    render(<ForecastCard {...baseProps} mode="when" setMode={noop}
      forecast={{ ...result, insufficientData: true, when: null, howMany: null }} />);
    expect(screen.getByText(/Sin suficiente histórico/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/components/Forecast/ForecastCard.test.tsx`
Expected: FAIL — cannot find module `./ForecastCard`.

- [ ] **Step 3: Implement**

```tsx
// client/src/components/Forecast/ForecastCard.tsx
import type { ForecastResult } from '../../lib/api';
import type { ForecastMode } from '../../hooks/useForecast';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import { ForecastHistogram } from './ForecastHistogram';

interface Props {
  forecast: ForecastResult | null;
  loading: boolean;
  mode: ForecastMode;
  setMode: (m: ForecastMode) => void;
  items: number | undefined;
  setItems: (n: number) => void;
  horizon: number;
  setHorizon: (n: number) => void;
}

function Toggle({ mode, setMode }: { mode: ForecastMode; setMode: (m: ForecastMode) => void }) {
  const btn = (m: ForecastMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`px-3 py-1 rounded-md ${mode === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
    >
      {label}
    </button>
  );
  return <div className="inline-flex gap-1 text-xs">{btn('when', '¿Cuándo?')}{btn('howMany', '¿Cuántos?')}</div>;
}

function ConfBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function ForecastCard(props: Props) {
  const { forecast, loading, mode, setMode, items, setItems, horizon, setHorizon } = props;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Forecast · Monte Carlo</h3>
          <InfoTooltip text="Simulación de 10.000 escenarios a partir del throughput diario de las últimas 12 semanas. ¿Cuándo?: días/fecha para completar N issues. ¿Cuántos?: issues completados en D días. Más confianza = fecha más tardía (¿cuándo?) o menos items (¿cuántos?)." />
        </div>
        <Toggle mode={mode} setMode={setMode} />
      </div>

      <div className="flex items-center gap-2 mb-4 text-xs text-slate-400">
        {mode === 'when' ? (
          <label className="flex items-center gap-2">Items a completar
            <input type="number" min={1} max={1000} value={items ?? ''}
              onChange={e => setItems(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200" />
          </label>
        ) : (
          <label className="flex items-center gap-2">Horizonte (días)
            <input type="number" min={1} max={365} value={horizon}
              onChange={e => setHorizon(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200" />
          </label>
        )}
      </div>

      {loading || !forecast ? (
        <div className="h-40 bg-slate-700/40 rounded animate-pulse" />
      ) : forecast.insufficientData ? (
        <div className="h-40 flex items-center justify-center text-center text-slate-500 text-sm px-6">
          Sin suficiente histórico para pronosticar (se necesitan entregas en las últimas 12 semanas).
        </div>
      ) : mode === 'when' && forecast.when ? (
        <>
          <div className="flex gap-2 mb-3">
            <ConfBlock label="50%" value={forecast.when.conf50.date} sub={`${forecast.when.conf50.days} días`} />
            <ConfBlock label="85%" value={forecast.when.conf85.date} sub={`${forecast.when.conf85.days} días`} />
            <ConfBlock label="95%" value={forecast.when.conf95.date} sub={`${forecast.when.conf95.days} días`} />
          </div>
          <p className="text-[11px] text-slate-600 mb-1">Más confianza = fecha más tardía (más segura).</p>
          <ForecastHistogram bins={forecast.when.histogram}
            marks={[{ x: forecast.when.conf50.days, label: 'P50' }, { x: forecast.when.conf85.days, label: 'P85' }, { x: forecast.when.conf95.days, label: 'P95' }]}
            unit="días" />
        </>
      ) : mode === 'howMany' && forecast.howMany ? (
        <>
          <div className="flex gap-2 mb-3">
            <ConfBlock label="50%" value={`≥ ${forecast.howMany.conf50}`} sub="issues" />
            <ConfBlock label="85%" value={`≥ ${forecast.howMany.conf85}`} sub="issues" />
            <ConfBlock label="95%" value={`≥ ${forecast.howMany.conf95}`} sub="issues" />
          </div>
          <p className="text-[11px] text-slate-600 mb-1">Más confianza = menos items (más seguro).</p>
          <ForecastHistogram bins={forecast.howMany.histogram}
            marks={[{ x: forecast.howMany.conf50, label: 'P50' }, { x: forecast.howMany.conf85, label: 'P85' }, { x: forecast.howMany.conf95, label: 'P95' }]}
            unit="issues" />
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/components/Forecast/ForecastCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Forecast/ForecastCard.tsx client/src/components/Forecast/ForecastCard.test.tsx
git commit -m "feat(client): ForecastCard — modes, confidence blocks, states"
```

---

## Task 10: Forecast container + mount in App

**Files:**
- Create: `client/src/components/Forecast/Forecast.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Implement the container**

```tsx
// client/src/components/Forecast/Forecast.tsx
import { useForecast } from '../../hooks/useForecast';
import { ForecastCard } from './ForecastCard';

export function Forecast() {
  const f = useForecast();
  return (
    <ForecastCard
      forecast={f.forecast}
      loading={f.loading}
      mode={f.mode}
      setMode={f.setMode}
      items={f.items}
      setItems={f.setItems}
      horizon={f.horizon}
      setHorizon={f.setHorizon}
    />
  );
}
```

- [ ] **Step 2: Mount it in App**

In `client/src/App.tsx`:
- Add the import near the other component imports:
```tsx
import { Forecast } from './components/Forecast/Forecast';
```
- Add a new row inside `<main>`, right after the `ThroughputChart`/`AgingWIP` grid `</div>` and before the `Comparativa del equipo` block:
```tsx
        <Forecast />
```

- [ ] **Step 3: Type-check + run full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: zero type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Forecast/Forecast.tsx client/src/App.tsx
git commit -m "feat(client): mount Forecast card on the dashboard"
```

---

## Task 11: Final verification

- [ ] **Step 1: Type-check both packages**

Run: `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 2: Run all tests**

Run: `cd server && npx vitest run && cd ../client && npx vitest run`
Expected: all green.

- [ ] **Step 3: Build the client**

Run: `cd client && npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev` from the repo root, open the dashboard, and confirm the Forecast card: the "¿Cuándo?" mode shows three dates (P50/P85/P95) and a histogram; toggling to "¿Cuántos?" shows three "≥ N issues" values; editing the items/horizon input updates the results after ~400 ms. (Requires a populated `data/kanban.db`.)

- [ ] **Step 5: Commit any final touch-ups** (only if needed)

```bash
git add -A && git commit -m "chore: forecast feature final verification"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** daily throughput over 84 days incl. `-0300` parsing → Task 2; 10k-trial sims for both modes + MAX_SIM_DAYS cap → Task 3; confidence wiring (when=p50/85/95, howMany=p50/p15/p5), date = asOf+ceil(days), histogram central-90% → Tasks 3-4; WIP default + clamps + insufficientData → Task 4; endpoint team-wide, own window → Task 5; client types/method → Task 6; debounced hook with WIP-default adoption → Task 7; card with toggle/inputs/confidence/microcopy/states + InfoTooltip → Task 9; histogram chart with P50/85/95 marks → Task 8; mount → Task 10; rng injection for determinism → `getForecast` `ForecastOpts.rng` (Task 4).
- **Type consistency:** `ForecastResult`/`ForecastWhen`/`ForecastHowMany`/`ForecastBin`/`ForecastConfidenceDate` defined in Task 1 and used identically in Tasks 4, 6, 8, 9. Hook returns `{ mode, setMode, items, setItems, horizon, setHorizon, forecast, loading }` consumed verbatim by the Task 10 container.
- **Deferred:** per-person / per-talla forecasts and sprint-date targets are out of scope per the spec.
```
