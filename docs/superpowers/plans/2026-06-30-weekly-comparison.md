# Weekly Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ComparisonCard` that shows throughput and WIP for a selected week vs. the immediately preceding week, with a week dropdown and an auto-generated insight line.

**Architecture:** New service `comparison.ts` computes throughput (done transitions in a week window) and WIP snapshot (last known state per issue before week end) from the `transitions` table. A single route exposes this as `GET /api/metrics/comparison?week=YYYY-MM-DD`. The client has a `useComparison(week)` hook that re-fetches on week change, a presentational `ComparisonCard`, and a `Comparison` container managing the selected week state. The card mounts above `KPICards` in `App.tsx`.

**Tech Stack:** Express + better-sqlite3 (server), React 18 + TypeScript + Tailwind CSS (client), Vitest + @testing-library/react (tests)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/types.ts` | Modify | Add `ComparisonPeriod`, `ComparisonResult` |
| `server/src/services/comparison.ts` | Create | `getComparison()`, `isoMonday()`, throughput + WIP queries |
| `server/src/services/comparison.test.ts` | Create | 5 service tests |
| `server/src/routes/metrics.ts` | Modify | Add `GET /comparison` route |
| `server/src/routes/routes.test.ts` | Modify | Add route shape test |
| `client/src/lib/api.ts` | Modify | Export `ComparisonResult`, `ComparisonPeriod`; add `api.comparison()` |
| `client/src/hooks/useComparison.ts` | Create | Fetch hook, re-fetches on week change |
| `client/src/components/Comparison/ComparisonCard.tsx` | Create | Presentational: selector, two metric blocks, insight line |
| `client/src/components/Comparison/ComparisonCard.test.tsx` | Create | 4 component tests |
| `client/src/components/Comparison/Comparison.tsx` | Create | Container: week state + hook wiring |
| `client/src/App.tsx` | Modify | Import + mount `<Comparison />` above `<KPICards />` |

---

## Task 1: Server types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add types after the `BottleneckResult` block (end of file)**

Open `server/src/types.ts`. Append after the last line:

```ts
export interface ComparisonPeriod {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;   // null when previous === 0
}

export interface ComparisonResult {
  week: string;       // YYYY-MM-DD, Monday of the selected week
  prevWeek: string;   // YYYY-MM-DD, Monday of the previous week
  throughput: ComparisonPeriod;
  wip: ComparisonPeriod;
}
```

- [ ] **Step 2: Type-check**

```bash
cd server && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(comparison): add ComparisonPeriod and ComparisonResult types"
```

---

## Task 2: Comparison service (TDD)

**Files:**
- Create: `server/src/services/comparison.test.ts`
- Create: `server/src/services/comparison.ts`

### Step 1 — Write the failing tests

- [ ] **Create `server/src/services/comparison.test.ts`:**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getComparison } from './comparison';

// Week under test: Mon 2026-06-23 → Sun 2026-06-29
// Previous week:   Mon 2026-06-16 → Sun 2026-06-22
const NOW = new Date('2026-06-25T12:00:00Z'); // Wednesday inside the current week
const WEEK     = '2026-06-23';
const PREV_WEEK = '2026-06-16';

let db: Database.Database;

function seedTransition(issueId: string, fromStatus: string, toStatus: string, at: string) {
  db.prepare(`INSERT OR IGNORE INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(issueId, `Issue ${issueId}`, '', toStatus, 'u1', 'M', 0.9,
        '2026-01-01T00:00:00Z', null, at, at);
  db.prepare(`UPDATE issues SET status = ? WHERE id = ?`).run(toStatus, issueId);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(issueId, fromStatus, toStatus, at);
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
});

describe('getComparison', () => {
  it('returns zero counts when no transitions exist', () => {
    const r = getComparison(db, { now: NOW });
    expect(r.week).toBe(WEEK);
    expect(r.prevWeek).toBe(PREV_WEEK);
    expect(r.throughput.current).toBe(0);
    expect(r.throughput.previous).toBe(0);
    expect(r.wip.current).toBe(0);
    expect(r.wip.previous).toBe(0);
  });

  it('throughput counts Done transitions only in the correct week window', () => {
    // Issue A: done in current week
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z');
    // Issue B: done in previous week
    seedTransition('B', 'In Progress', 'Finalizada', '2026-06-17T10:00:00Z');
    // Issue C: done after current week (should not count)
    seedTransition('C', 'In Progress', 'Done', '2026-07-01T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    expect(r.throughput.current).toBe(1);   // only A
    expect(r.throughput.previous).toBe(1);  // only B
    expect(r.throughput.delta).toBe(0);
  });

  it('wip snapshot excludes issues that are Done at end of week', () => {
    // Issue A: was In Progress at start of current week, became Done mid-week
    seedTransition('A', 'To Do', 'In Progress', '2026-06-20T10:00:00Z');
    seedTransition('A', 'In Progress', 'Done', '2026-06-25T10:00:00Z');
    // Issue B: still In Progress at end of week
    seedTransition('B', 'To Do', 'In Progress', '2026-06-23T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    // End of prev week (start of 2026-06-23): A was In Progress, B not yet started → wip.previous=1
    expect(r.wip.previous).toBe(1);
    // End of current week (start of 2026-06-30): A is Done, B still In Progress → wip.current=1
    expect(r.wip.current).toBe(1);
  });

  it('deltaPct is null when previous is 0', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-24T10:00:00Z');

    const r = getComparison(db, { now: NOW });
    expect(r.throughput.current).toBe(1);
    expect(r.throughput.previous).toBe(0);
    expect(r.throughput.deltaPct).toBeNull();
  });

  it('opts.week selects a past week correctly', () => {
    seedTransition('A', 'In Progress', 'Done', '2026-06-17T10:00:00Z'); // in prev week

    const r = getComparison(db, { week: PREV_WEEK, now: NOW });
    expect(r.week).toBe(PREV_WEEK);
    expect(r.throughput.current).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd server && npm test -- --reporter=verbose src/services/comparison.test.ts
```

Expected: FAIL with "Cannot find module './comparison'".

- [ ] **Step 3: Create `server/src/services/comparison.ts`:**

```ts
import Database from 'better-sqlite3';
import { STATUS_CATEGORIES } from './statusCategories';
import type { ComparisonResult, ComparisonPeriod } from '../types';

const DONE_STATUSES = [...STATUS_CATEGORIES.done] as string[];

const WIP_EXCLUDED = [
  ...STATUS_CATEGORIES.done,
  ...STATUS_CATEGORIES.cancelled,
  ...STATUS_CATEGORIES.todo,
] as string[];

function isoMonday(date: Date): string {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const mon = new Date(date);
  mon.setUTCDate(date.getUTCDate() - diff);
  return mon.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function period(current: number, previous: number): ComparisonPeriod {
  return {
    current,
    previous,
    delta: current - previous,
    deltaPct: previous === 0 ? null : Math.round((current - previous) / previous * 100),
  };
}

function getThroughput(db: Database.Database, weekStart: string, weekEnd: string): number {
  const doneIn = DONE_STATUSES.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COUNT(DISTINCT issue_id) AS count
    FROM transitions
    WHERE to_status IN (${doneIn})
      AND transitioned_at >= ?
      AND transitioned_at < ?
  `).get(...DONE_STATUSES, weekStart + 'T00:00:00Z', weekEnd + 'T00:00:00Z') as { count: number };
  return row.count;
}

function getWipSnapshot(db: Database.Database, weekEnd: string): number {
  const wipExIn = WIP_EXCLUDED.map(() => '?').join(',');
  const row = db.prepare(`
    WITH last_before AS (
      SELECT issue_id, to_status,
        ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY transitioned_at DESC) AS rn
      FROM transitions
      WHERE transitioned_at < ?
    )
    SELECT COUNT(*) AS count
    FROM last_before
    WHERE rn = 1
      AND to_status NOT IN (${wipExIn})
  `).get(weekEnd + 'T00:00:00Z', ...WIP_EXCLUDED) as { count: number };
  return row.count;
}

export function getComparison(
  db: Database.Database,
  opts: { week?: string; now?: Date } = {}
): ComparisonResult {
  const now = opts.now ?? new Date();
  const week = opts.week ?? isoMonday(now);
  const prevWeek = addDays(week, -7);
  const nextWeek = addDays(week, 7);

  return {
    week,
    prevWeek,
    throughput: period(
      getThroughput(db, week, nextWeek),
      getThroughput(db, prevWeek, week)
    ),
    wip: period(
      getWipSnapshot(db, nextWeek),
      getWipSnapshot(db, week)
    ),
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npm test -- --reporter=verbose src/services/comparison.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Run full server test suite — no regressions**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/comparison.ts server/src/services/comparison.test.ts
git commit -m "feat(comparison): add weekly comparison service (TDD)"
```

---

## Task 3: Route + route test

**Files:**
- Modify: `server/src/routes/metrics.ts`
- Modify: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Add import to `server/src/routes/metrics.ts`**

Find the existing imports at the top of the file and add:

```ts
import { getComparison } from '../services/comparison';
```

- [ ] **Step 2: Add route to `server/src/routes/metrics.ts`**

Add after the `/bottleneck` route (at the end of the file, before `export default router`):

```ts
router.get('/comparison', (req, res, next) => {
  try {
    const week = typeof req.query.week === 'string' ? req.query.week : undefined;
    res.json(getComparison(getDb(), { week }));
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Add route test to `server/src/routes/routes.test.ts`**

Append at the end of the file:

```ts
describe('GET /api/metrics/comparison', () => {
  it('returns 200 with ComparisonResult shape', async () => {
    const res = await request(app).get('/api/metrics/comparison');
    expect(res.status).toBe(200);
    expect(typeof res.body.week).toBe('string');
    expect(typeof res.body.prevWeek).toBe('string');
    expect(typeof res.body.throughput.current).toBe('number');
    expect(typeof res.body.throughput.delta).toBe('number');
    expect(typeof res.body.wip.current).toBe('number');
    expect(typeof res.body.wip.delta).toBe('number');
  });
});
```

- [ ] **Step 4: Run server tests**

```bash
cd server && npm test
```

Expected: all tests pass (new route test included).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/metrics.ts server/src/routes/routes.test.ts
git commit -m "feat(comparison): add GET /api/metrics/comparison route"
```

---

## Task 4: Client API types + `comparison()` method

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add types to the import line**

Find the existing `import type { ... }` line at the top of `client/src/lib/api.ts`. Add `ComparisonResult, ComparisonPeriod` to it:

```ts
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore, ComparisonResult, ComparisonPeriod } from '../../../server/src/types';
```

- [ ] **Step 2: Add types to the export line**

Find the existing `export type { ... }` line and add `ComparisonResult, ComparisonPeriod` to it:

```ts
export type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore, ComparisonResult, ComparisonPeriod };
```

- [ ] **Step 3: Add `comparison()` to the `api` object**

Inside the `export const api = { ... }` object, add after `bottleneck`:

```ts
  comparison: (week?: string) => get<ComparisonResult>(`/metrics/comparison${week ? `?week=${encodeURIComponent(week)}` : ''}`),
```

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(comparison): add client API types and comparison() method"
```

---

## Task 5: `useComparison` hook

**Files:**
- Create: `client/src/hooks/useComparison.ts`

- [ ] **Step 1: Create `client/src/hooks/useComparison.ts`**

```ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ComparisonResult } from '../lib/api';

export function useComparison(week: string | undefined) {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.comparison(week)
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [week]);

  return { result, loading };
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useComparison.ts
git commit -m "feat(comparison): add useComparison hook"
```

---

## Task 6: `ComparisonCard` component + tests

**Files:**
- Create: `client/src/components/Comparison/ComparisonCard.tsx`
- Create: `client/src/components/Comparison/ComparisonCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/Comparison/ComparisonCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComparisonCard } from './ComparisonCard';
import type { ComparisonResult } from '../../lib/api';

const fixture: ComparisonResult = {
  week: '2026-06-23',
  prevWeek: '2026-06-16',
  throughput: { current: 12, previous: 9, delta: 3, deltaPct: 33 },
  wip: { current: 18, previous: 14, delta: 4, deltaPct: 29 },
};

describe('ComparisonCard', () => {
  it('renders both metric values', () => {
    render(<ComparisonCard result={fixture} loading={false} week={undefined} setWeek={() => {}} />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
  });

  it('shows the correct insight line for throughput↑ + wip↑', () => {
    render(<ComparisonCard result={fixture} loading={false} week={undefined} setWeek={() => {}} />);
    expect(screen.getByText(/velocidad de entrega no absorbió/)).toBeTruthy();
  });

  it('shows loading skeleton and no metric values when loading=true', () => {
    const { container } = render(<ComparisonCard result={null} loading={true} week={undefined} setWeek={() => {}} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('calls setWeek when the week selector changes', () => {
    const setWeek = vi.fn();
    render(<ComparisonCard result={fixture} loading={false} week="2026-06-23" setWeek={setWeek} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '2026-06-16' } });
    expect(setWeek).toHaveBeenCalledWith('2026-06-16');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd client && npm test -- --reporter=verbose src/components/Comparison/ComparisonCard.test.tsx
```

Expected: FAIL with "Cannot find module './ComparisonCard'".

- [ ] **Step 3: Create `client/src/components/Comparison/ComparisonCard.tsx`**

```tsx
import type { ComparisonResult, ComparisonPeriod } from '../../lib/api';

interface Props {
  result: ComparisonResult | null;
  loading: boolean;
  week: string | undefined;
  setWeek: (w: string) => void;
}

function getRecentMondays(n: number): string[] {
  const mondays: string[] = [];
  const today = new Date();
  const diff = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - diff);
  thisMonday.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const mon = new Date(thisMonday);
    mon.setDate(thisMonday.getDate() - i * 7);
    mondays.push(mon.toISOString().slice(0, 10));
  }
  return mondays;
}

function formatWeekLabel(mondayStr: string): string {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  const sun = new Date(y, m - 1, d + 6);
  const fmt = (date: Date) => date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function deltaColor(delta: number, metric: 'throughput' | 'wip'): string {
  if (delta === 0) return 'text-slate-500';
  if (metric === 'throughput') return delta > 0 ? 'text-green-400' : 'text-red-400';
  return delta > 0 ? 'text-amber-400' : 'text-green-400';
}

function arrow(delta: number): string {
  return delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
}

function insight(r: ComparisonResult): string {
  const tUp = r.throughput.delta > 0, tDown = r.throughput.delta < 0;
  const wUp = r.wip.delta > 0, wDown = r.wip.delta < 0;
  if (tUp && wDown) return 'Buena semana: más entregas y menos trabajo en curso.';
  if (tUp && wUp)   return 'El throughput subió pero el WIP también — la velocidad de entrega no absorbió todo el trabajo nuevo.';
  if (tDown && wUp) return 'Semana difícil: menos entregas y más trabajo acumulado.';
  if (tDown && wDown) return 'Menos entregas, pero el WIP bajó — puede ser una semana de enfoque o depuración.';
  return 'Sin cambios significativos respecto a la semana anterior.';
}

function MetricBlock({ label, p, metric }: { label: string; p: ComparisonPeriod; metric: 'throughput' | 'wip' }) {
  const col = deltaColor(p.delta, metric);
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-3">{label}</div>
      <div className="flex items-end gap-6">
        <div>
          <div className="text-[11px] text-slate-400 mb-1">Esta semana</div>
          <div className="text-3xl font-bold text-slate-100 leading-none">{p.current}</div>
        </div>
        <div className={`flex flex-col items-center pb-1 ${col}`}>
          <span className="text-xl font-semibold leading-none">{arrow(p.delta)}</span>
          <span className="text-sm font-semibold">{p.delta > 0 ? '+' : ''}{p.delta}</span>
          {p.deltaPct !== null && (
            <span className="text-[10px]">{p.delta > 0 ? '+' : ''}{p.deltaPct}%</span>
          )}
        </div>
        <div>
          <div className="text-[11px] text-slate-400 mb-1">Sem. anterior</div>
          <div className="text-3xl font-bold text-slate-500 leading-none">{p.previous}</div>
        </div>
      </div>
    </div>
  );
}

export function ComparisonCard({ result, loading, week, setWeek }: Props) {
  const mondays = getRecentMondays(12);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Comparativa semanal</h3>
        <select
          value={week ?? ''}
          onChange={e => setWeek(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        >
          {week === undefined && <option value="">Semana actual</option>}
          {mondays.map(m => (
            <option key={m} value={m}>{formatWeekLabel(m)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 bg-slate-700/40 rounded-lg animate-pulse" />
          <div className="h-24 bg-slate-700/40 rounded-lg animate-pulse" />
        </div>
      ) : !result ? (
        <div className="h-24 flex items-center justify-center text-slate-500 text-sm">
          Sin datos para la semana seleccionada.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <MetricBlock label="Throughput" p={result.throughput} metric="throughput" />
            <MetricBlock label="WIP al cierre" p={result.wip} metric="wip" />
          </div>
          <p className="text-[11px] text-slate-500">{insight(result)}</p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd client && npm test -- --reporter=verbose src/components/Comparison/ComparisonCard.test.tsx
```

Expected: 4/4 PASS.

- [ ] **Step 5: Run full client test suite — no regressions**

```bash
cd client && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Comparison/ComparisonCard.tsx client/src/components/Comparison/ComparisonCard.test.tsx
git commit -m "feat(comparison): add ComparisonCard presentational component"
```

---

## Task 7: `Comparison` container + `App.tsx` mount

**Files:**
- Create: `client/src/components/Comparison/Comparison.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create `client/src/components/Comparison/Comparison.tsx`**

```tsx
import { useState } from 'react';
import { useComparison } from '../../hooks/useComparison';
import { ComparisonCard } from './ComparisonCard';

export function Comparison() {
  const [week, setWeek] = useState<string | undefined>(undefined);
  const { result, loading } = useComparison(week);
  return <ComparisonCard result={result} loading={loading} week={week} setWeek={setWeek} />;
}
```

- [ ] **Step 2: Add import to `client/src/App.tsx`**

Add after the `Bottleneck` import (line 11):

```ts
import { Comparison } from './components/Comparison/Comparison';
```

- [ ] **Step 3: Mount `<Comparison />` in `client/src/App.tsx`**

Find the `<main>` content block. Add `<Comparison />` as the **first element** inside `<main className="px-6 py-4 flex flex-col gap-4">`, directly before `<KPICards ...`:

```tsx
      <main className="px-6 py-4 flex flex-col gap-4">
        <Comparison />
        <KPICards kpis={kpis} loading={loading} />
```

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run full client test suite**

```bash
cd client && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Comparison/Comparison.tsx client/src/App.tsx
git commit -m "feat(comparison): mount Comparison card at top of dashboard"
```
