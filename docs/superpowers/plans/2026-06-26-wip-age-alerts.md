# WIP Age vs. Limits + Early Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag in-progress issues whose elapsed age exceeds (or approaches) the data-derived p85 cycle time for their size, in a new "WIP en riesgo" dashboard card backed by `GET /api/metrics/wip-risk`.

**Architecture:** A self-contained server module `wipRisk.ts` derives a per-talla p85 limit from the last 12 weeks of completed cycle times (reusing `getCycleTimes`), evaluates each started-but-not-done issue's age (now − first active entry) against its talla limit, and classifies it `en_riesgo`/`excedido`. The client adds a presentational `WipRiskCard` (fixture-tested) wrapped by a `WipRisk` container that fetches via `useWipRisk`.

**Tech Stack:** Node 20 + TypeScript + better-sqlite3 + Express (server); Vite + React 18 + TS + Tailwind (client). Tests: Vitest (+ supertest, @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-06-26-wip-age-alerts-design.md`

---

## File Structure

**Create:**
- `server/src/services/wipRisk.ts` — per-talla limits, active-issue ages, `getWipRisk`.
- `server/src/services/wipRisk.test.ts`.
- `client/src/hooks/useWipRisk.ts` — fetch on mount.
- `client/src/components/WipRisk/WipRiskCard.tsx` — presentational card.
- `client/src/components/WipRisk/WipRisk.tsx` — container (hook + card).
- `client/src/components/WipRisk/WipRiskCard.test.tsx`.

**Modify:**
- `server/src/types.ts` — add wip-risk types.
- `server/src/services/metrics.ts` — export `getCycleTimes` (currently private) for reuse.
- `server/src/routes/metrics.ts` — add `/wip-risk` route.
- `server/src/routes/routes.test.ts` — add `/api/metrics/wip-risk` shape test.
- `client/src/lib/api.ts` — export wip-risk types + `api.wipRisk`.
- `client/src/App.tsx` — mount `<WipRisk />`.

---

## Task 1: WIP-risk types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Append the types**

Add to the end of `server/src/types.ts`:

```ts
export type WipRiskLevel = 'en_riesgo' | 'excedido';

export interface WipRiskItem {
  issue_id: string;
  title: string;
  talla: Talla;                 // non-null: items without talla are excluded
  status: string;               // current status
  assignee_id: string | null;
  age_days: number;             // now − first active entry
  limit_days: number;           // p85 of the issue's talla
  ratio: number;                // age_days / limit_days
  level: WipRiskLevel;
}

export interface TallaLimit {
  talla: Talla;
  limit_days: number | null;    // null when sample_count < MIN_SAMPLES
  sample_count: number;
}

export interface WipRiskResult {
  lookbackDays: number;         // 84
  limits: TallaLimit[];         // S, M, L, XL
  items: WipRiskItem[];         // only en_riesgo + excedido, sorted by ratio desc
  counts: { en_riesgo: number; excedido: number; sin_limite: number };
}
```

- [ ] **Step 2: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): WIP-risk result types"
```

---

## Task 2: Export getCycleTimes for reuse

**Files:**
- Modify: `server/src/services/metrics.ts`

- [ ] **Step 1: Make the function exported**

In `server/src/services/metrics.ts`, change the declaration of `getCycleTimes` from:
```ts
function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
```
to:
```ts
export function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
```
(Only add the `export` keyword. Do not change the body or any caller — internal callers keep working unchanged.)

- [ ] **Step 2: Verify nothing broke**

Run: `cd server && npx tsc --noEmit && npx vitest run src/services/metrics.test.ts`
Expected: zero type errors; metrics tests still pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/metrics.ts
git commit -m "refactor(server): export getCycleTimes for reuse"
```

---

## Task 3: wipRisk service + tests

**Files:**
- Create: `server/src/services/wipRisk.ts`
- Test: `server/src/services/wipRisk.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// server/src/services/wipRisk.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getWipRisk } from './wipRisk';

const NOW = new Date('2026-06-26T12:00:00Z');

// A completed issue: enters In Progress at `startAt`, reaches Done at `doneAt`.
function seedCompleted(db: Database.Database, id: string, talla: string, startAt: string, doneAt: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `Done ${id}`, '', 'Done', null, talla, 0.9, '2026-01-01T00:00:00Z', doneAt, '2026-06-26T00:00:00Z', doneAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', 'In Progress', startAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'In Progress', 'Done', doneAt);
}

// An in-progress issue: enters In Progress at `startAt`, optional extra transitions, not Done.
function seedActive(db: Database.Database, id: string, talla: string | null, status: string, startAt: string, extra: [string, string][] = []) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `WIP ${id}`, '', status, 'u1', talla, 0.9, '2026-06-01T00:00:00Z', startAt, '2026-06-26T00:00:00Z', startAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', 'In Progress', startAt);
  for (const [to, at] of extra) {
    db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
      .run(id, 'In Progress', to, at);
  }
}

// Seed 5 completed of `talla`, each with a cycle time of `cycleDays` days (within the window).
function seedFiveCompleted(db: Database.Database, talla: string, cycleDays: number, idPrefix: string) {
  for (let i = 0; i < 5; i++) {
    const start = `2026-06-1${i}T00:00:00Z`;
    const done = new Date(new Date(start).getTime() + cycleDays * 86400000).toISOString();
    seedCompleted(db, `${idPrefix}-${i}`, talla, start, done);
  }
}

describe('getWipRisk', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applySchema(db); });

  it('derives the p85 limit and sample_count per talla', () => {
    // 5 M completed, all 4-day cycle → p85 = 4
    seedFiveCompleted(db, 'M', 4, 'M');
    const r = getWipRisk(db, { now: NOW });
    const m = r.limits.find(l => l.talla === 'M')!;
    expect(m.sample_count).toBe(5);
    expect(m.limit_days).toBeCloseTo(4, 5);
    const s = r.limits.find(l => l.talla === 'S')!;
    expect(s.limit_days).toBeNull();        // no S data
    expect(s.sample_count).toBe(0);
  });

  it('nulls the limit and counts sin_limite when under MIN_SAMPLES', () => {
    seedCompleted(db, 'S-a', 'S', '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z'); // 1 only
    seedActive(db, 'WIP-S', 'S', 'In Progress', '2026-06-01T00:00:00Z');           // started, not done
    const r = getWipRisk(db, { now: NOW });
    expect(r.limits.find(l => l.talla === 'S')!.limit_days).toBeNull();
    expect(r.items.find(i => i.issue_id === 'WIP-S')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('classifies excedido / en_riesgo / hidden by ratio', () => {
    seedFiveCompleted(db, 'L', 10, 'L');                                  // limit_L = 10
    seedActive(db, 'WIP-over', 'L', 'In Progress', '2026-06-14T12:00:00Z'); // 12 days → ratio 1.2
    seedActive(db, 'WIP-risk', 'L', 'In Progress', '2026-06-18T12:00:00Z'); // 8 days  → ratio 0.8
    seedActive(db, 'WIP-ok', 'L', 'In Progress', '2026-06-21T12:00:00Z');   // 5 days  → ratio 0.5
    const r = getWipRisk(db, { now: NOW });
    const over = r.items.find(i => i.issue_id === 'WIP-over')!;
    const risk = r.items.find(i => i.issue_id === 'WIP-risk')!;
    expect(over.level).toBe('excedido');
    expect(risk.level).toBe('en_riesgo');
    expect(r.items.find(i => i.issue_id === 'WIP-ok')).toBeUndefined();
    expect(r.counts).toMatchObject({ en_riesgo: 1, excedido: 1 });
  });

  it('measures age from the first active entry even if currently blocked', () => {
    seedFiveCompleted(db, 'M', 2, 'M');                                   // limit_M = 2
    // Entered active 6 days ago, blocked 1 day ago, not done → age 6, ratio 3.0
    seedActive(db, 'WIP-b', 'M', 'Blocked', '2026-06-20T12:00:00Z', [['Blocked', '2026-06-25T12:00:00Z']]);
    const r = getWipRisk(db, { now: NOW });
    const it = r.items.find(i => i.issue_id === 'WIP-b')!;
    expect(it.age_days).toBeCloseTo(6, 1);
    expect(it.level).toBe('excedido');
  });

  it('counts issues without a talla as sin_limite', () => {
    seedFiveCompleted(db, 'M', 4, 'M');
    seedActive(db, 'WIP-notalla', null, 'In Progress', '2026-06-01T00:00:00Z');
    const r = getWipRisk(db, { now: NOW });
    expect(r.items.find(i => i.issue_id === 'WIP-notalla')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('sorts items by ratio descending', () => {
    seedFiveCompleted(db, 'L', 10, 'L');
    seedActive(db, 'WIP-a', 'L', 'In Progress', '2026-06-15T12:00:00Z'); // 11 days → 1.1
    seedActive(db, 'WIP-b', 'L', 'In Progress', '2026-06-10T12:00:00Z'); // 16 days → 1.6
    const r = getWipRisk(db, { now: NOW });
    expect(r.items.map(i => i.issue_id)).toEqual(['WIP-b', 'WIP-a']);
  });

  it('handles Jira -0300 timestamps without NaN', () => {
    seedFiveCompleted(db, 'M', 4, 'M');
    seedActive(db, 'WIP-tz', 'M', 'In Progress', '2026-06-20T12:00:00-0300'); // age ~6 days
    const r = getWipRisk(db, { now: NOW });
    const it = r.items.find(i => i.issue_id === 'WIP-tz')!;
    expect(Number.isNaN(it.age_days)).toBe(false);
    expect(it.age_days).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/services/wipRisk.test.ts`
Expected: FAIL — cannot find module `./wipRisk`.

- [ ] **Step 3: Implement the service**

```ts
// server/src/services/wipRisk.ts
import Database from 'better-sqlite3';
import { percentile } from './stats';
import { getCycleTimes } from './metrics';
import { ACTIVE_STATUSES, STATUS_CATEGORIES } from './statusCategories';
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/services/wipRisk.test.ts`
Expected: PASS (7 tests). Also `cd server && npx tsc --noEmit` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/wipRisk.ts server/src/services/wipRisk.test.ts
git commit -m "feat(server): WIP-risk service — per-talla p85 limits + age classification"
```

---

## Task 4: Route + route test

**Files:**
- Modify: `server/src/routes/metrics.ts`
- Modify: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` to `server/src/routes/routes.test.ts`:

```ts
describe('GET /api/metrics/wip-risk', () => {
  it('returns 200 with the wip-risk shape', async () => {
    const res = await request(app).get('/api/metrics/wip-risk');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lookbackDays', 84);
    expect(res.body).toHaveProperty('limits');
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('counts');
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Add the route**

In `server/src/routes/metrics.ts`:
- Add the import near the other service imports:
```ts
import { getWipRisk } from '../services/wipRisk';
```
- Add this route AFTER the `/forecast` route and BEFORE `export default router;`:
```ts
router.get('/wip-risk', (_req, res, next) => {
  try {
    res.json(getWipRisk(getDb()));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS — all suites green. Also `cd server && npx tsc --noEmit` → zero errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/metrics.ts server/src/routes/routes.test.ts
git commit -m "feat(server): GET /api/metrics/wip-risk route"
```

---

## Task 5: Client API types + method

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add types and method**

In `client/src/lib/api.ts`:
- Add `WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel` to BOTH the `import type { ... }` and `export type { ... }` lines (keep all existing names).
- Add this method inside the `api` object (next to `forecast`):

```ts
  wipRisk: () => get<WipRiskResult>('/metrics/wip-risk'),
```

- [ ] **Step 2: Type-check**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(client): wip-risk API types + method"
```

---

## Task 6: useWipRisk hook

**Files:**
- Create: `client/src/hooks/useWipRisk.ts`

- [ ] **Step 1: Implement the hook**

```ts
// client/src/hooks/useWipRisk.ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { WipRiskResult } from '../lib/api';

export function useWipRisk() {
  const [result, setResult] = useState<WipRiskResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.wipRisk()
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { result, loading };
}
```

- [ ] **Step 2: Type-check + commit**

Run: `cd client && npx tsc --noEmit`
Expected: zero errors.

```bash
git add client/src/hooks/useWipRisk.ts
git commit -m "feat(client): useWipRisk hook"
```

---

## Task 7: WipRiskCard (presentational) + test

**Files:**
- Create: `client/src/components/WipRisk/WipRiskCard.tsx`
- Test: `client/src/components/WipRisk/WipRiskCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/WipRisk/WipRiskCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WipRiskCard } from './WipRiskCard';
import type { WipRiskResult } from '../../lib/api';

const base: WipRiskResult = {
  lookbackDays: 84,
  limits: [
    { talla: 'S', limit_days: 1.9, sample_count: 8 },
    { talla: 'M', limit_days: 2.0, sample_count: 12 },
    { talla: 'L', limit_days: 6.1, sample_count: 6 },
    { talla: 'XL', limit_days: null, sample_count: 2 },
  ],
  items: [
    { issue_id: 'OPS-142', title: 'Migrar auth', talla: 'L', status: 'In Progress', assignee_id: 'u1', age_days: 9.4, limit_days: 6.1, ratio: 1.54, level: 'excedido' },
    { issue_id: 'OPS-201', title: 'Ajustar dash', talla: 'S', status: 'In Progress', assignee_id: 'u2', age_days: 1.6, limit_days: 1.9, ratio: 0.84, level: 'en_riesgo' },
  ],
  counts: { en_riesgo: 1, excedido: 1, sin_limite: 1 },
};

describe('WipRiskCard', () => {
  it('renders the count line and one row per item', () => {
    render(<WipRiskCard result={base} loading={false} />);
    expect(screen.getByText(/1 en riesgo/)).toBeInTheDocument();
    expect(screen.getByText(/1 excedido/)).toBeInTheDocument();
    expect(screen.getByText('OPS-142')).toBeInTheDocument();
    expect(screen.getByText('OPS-201')).toBeInTheDocument();
  });

  it('shows the empty state when there are no at-risk items', () => {
    render(<WipRiskCard result={{ ...base, items: [], counts: { en_riesgo: 0, excedido: 0, sin_limite: 0 } }} loading={false} />);
    expect(screen.getByText(/Nada en riesgo/)).toBeInTheDocument();
  });

  it('shows a loading skeleton while loading', () => {
    const { container } = render(<WipRiskCard result={null} loading={true} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/components/WipRisk/WipRiskCard.test.tsx`
Expected: FAIL — cannot find module `./WipRiskCard`.

- [ ] **Step 3: Implement**

```tsx
// client/src/components/WipRisk/WipRiskCard.tsx
import type { WipRiskResult, WipRiskItem } from '../../lib/api';
import type { Talla } from '../../../../server/src/types';
import { TALLA_BG } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

interface Props {
  result: WipRiskResult | null;
  loading: boolean;
}

function RatioBar({ item }: { item: WipRiskItem }) {
  const color = item.level === 'excedido' ? 'bg-red-500' : 'bg-amber-500';
  const pct = Math.min(item.ratio, 1.5) / 1.5 * 100; // 0..150% mapped to bar width
  const limitPct = 1 / 1.5 * 100;                     // the 100% (limit) marker
  return (
    <div className="relative h-1.5 w-16 bg-slate-700 rounded">
      <div className={`absolute top-0 left-0 h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      <div className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-300 rounded" style={{ left: `${limitPct}%` }} />
    </div>
  );
}

export function WipRiskCard({ result, loading }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">WIP en riesgo</h3>
        <InfoTooltip text="Issues en curso cuya edad (desde que entraron a un estado activo) se acerca o supera el cycle time esperado de su talla (p85 de las últimas 12 semanas). ⚠ en riesgo ≥ 70% del límite; ● excedido ≥ 100%." />
      </div>

      {loading || !result ? (
        <div className="mt-3 h-40 bg-slate-700/40 rounded animate-pulse" />
      ) : (
        <>
          <p className="text-xs mb-4 flex gap-3">
            <span className="text-amber-400">⚠ {result.counts.en_riesgo} en riesgo</span>
            <span className="text-red-400">● {result.counts.excedido} excedido{result.counts.excedido === 1 ? '' : 's'}</span>
            {result.counts.sin_limite > 0 && <span className="text-slate-600">· {result.counts.sin_limite} sin límite</span>}
          </p>

          {result.items.length === 0 ? (
            <div className="py-6 text-center text-slate-500 text-sm">Nada en riesgo para su talla 🎉</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
                  <th className="text-left pb-2">Issue</th>
                  <th className="text-left pb-2">Título</th>
                  <th className="text-left pb-2">Talla</th>
                  <th className="text-right pb-2">Edad</th>
                  <th className="text-right pb-2">Límite</th>
                  <th className="text-right pb-2">Nivel</th>
                </tr>
              </thead>
              <tbody>
                {result.items.slice(0, 8).map(item => (
                  <tr key={item.issue_id} className="border-t border-slate-700 hover:bg-slate-700/40">
                    <td className="py-2 font-mono text-blue-400 font-semibold">{item.issue_id}</td>
                    <td className="py-2 text-slate-300 max-w-[140px] truncate pr-2">{item.title}</td>
                    <td className="py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${TALLA_BG[item.talla as Talla]}`}>{item.talla}</span>
                    </td>
                    <td className="py-2 text-right text-slate-300">{item.age_days.toFixed(1)}d</td>
                    <td className="py-2 text-right text-slate-500">{item.limit_days.toFixed(1)}d</td>
                    <td className="py-2">
                      <div className="flex justify-end">
                        <RatioBar item={item} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/components/WipRisk/WipRiskCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/WipRisk/WipRiskCard.tsx client/src/components/WipRisk/WipRiskCard.test.tsx
git commit -m "feat(client): WipRiskCard — count line, ratio bars, states"
```

---

## Task 8: Container + mount + final verification

**Files:**
- Create: `client/src/components/WipRisk/WipRisk.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Implement the container**

```tsx
// client/src/components/WipRisk/WipRisk.tsx
import { useWipRisk } from '../../hooks/useWipRisk';
import { WipRiskCard } from './WipRiskCard';

export function WipRisk() {
  const { result, loading } = useWipRisk();
  return <WipRiskCard result={result} loading={loading} />;
}
```

- [ ] **Step 2: Mount it in App**

In `client/src/App.tsx`:
- Add the import alongside the other component imports:
```tsx
import { WipRisk } from './components/WipRisk/WipRisk';
```
- Mount `<WipRisk />` as a new row immediately AFTER the `grid grid-cols-2` block containing `ThroughputChart`/`AgingWIP` and BEFORE `<Forecast />`:
```tsx
        <div className="grid grid-cols-2 gap-4">
          <ThroughputChart data={throughput} />
          <AgingWIP issues={aging} />
        </div>
        <WipRisk />
        <Forecast />
```

- [ ] **Step 3: Type-check + run full client suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: zero type errors; all client tests pass.

- [ ] **Step 4: Verify both packages end to end**

Run: `cd server && npx tsc --noEmit && npx vitest run && cd ../client && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green; client builds.

- [ ] **Step 5: Manual smoke check**

Run `npm run dev` from the repo root, open the dashboard, and confirm the "WIP en riesgo" card shows the count line (⚠ en riesgo · ● excedido · sin límite), a row per at-risk issue with talla pill, age, p85 limit, and a colored ratio bar (amber for en_riesgo, red for excedido). With no at-risk issues it shows "Nada en riesgo para su talla 🎉". (Requires a populated `data/kanban.db`.)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/WipRisk/WipRisk.tsx client/src/App.tsx
git commit -m "feat(client): mount WIP-risk card on the dashboard"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** per-talla p85 limit over 84-day window with MIN_SAMPLES guard → `tallaLimits` (Task 3); age from first active entry incl. blocked issues → `activeIssues` + `getWipRisk` (Task 3, tested); classification excedido/en_riesgo/hidden by RISK_RATIO/BREACH_RATIO → Task 3; null talla / null limit → `counts.sin_limite` (Task 3); ratio-desc ordering → Task 3; `-0300` timestamps in JS → Task 3 (tested); endpoint team-wide no params → Task 4; client types/method → Task 5; fetch-on-mount hook → Task 6; card with count line + ratio bars + empty/loading states + InfoTooltip → Task 7; mount near Aging WIP → Task 8; `getCycleTimes` reuse via export → Task 2.
- **Type consistency:** `WipRiskResult`/`WipRiskItem`/`TallaLimit`/`WipRiskLevel` defined in Task 1, used identically in Tasks 3, 5, 7. `getWipRisk(db, { now })` signature used by Task 4 route (no opts → defaults to `new Date()`) and Task 3 tests (inject `now`). Hook returns `{ result, loading }` consumed verbatim by the Task 8 container.
- **Deferred:** manual per-talla limit overrides, assignee filtering, and push/external alerts are out of scope per the spec.
```
