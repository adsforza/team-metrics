# Weekly Comparison — Design Spec

**Date:** 2026-06-30
**Feature:** Vista histórica / comparativa a nivel tablero (backlog item #3)

---

## Summary

Add a `ComparisonCard` to the dashboard that compares throughput and WIP between two consecutive weeks. The user picks the "current" week from a dropdown of the last 12 weeks; the card always shows that week vs. the immediately preceding one. Placed at the top of the dashboard, above KPICards.

---

## Design Decisions

| Question | Decision |
|---|---|
| Metrics | Throughput (issues completed) + WIP (issues in active state at end of week) |
| Period unit | ISO week (Monday–Sunday) |
| Period selection | Dropdown of last 12 weeks; default = current week |
| Comparison | Always vs. immediately preceding week (no custom second period) |
| Insight line | Client-computed from the two deltas |
| Dashboard placement | Full-width, above KPICards |

---

## Types (`server/src/types.ts`)

```ts
export interface ComparisonPeriod {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;   // null if previous === 0
}

export interface ComparisonResult {
  week: string;              // YYYY-MM-DD (Monday of selected week)
  prevWeek: string;          // YYYY-MM-DD (Monday of previous week)
  throughput: ComparisonPeriod;
  wip: ComparisonPeriod;
}
```

---

## Server: `server/src/services/comparison.ts`

### Constants

```ts
import { STATUS_CATEGORIES } from './statusCategories';

const DONE_STATUSES   = STATUS_CATEGORIES.done;       // ['Done', 'Finalizada']
const WIP_EXCLUDED    = [                             // statuses that don't count as WIP
  ...STATUS_CATEGORIES.done,
  ...STATUS_CATEGORIES.cancelled,
  ...STATUS_CATEGORIES.todo,
];
```

WIP = issues whose last known state is NOT in `WIP_EXCLUDED` (i.e. not done, not cancelled, not todo/backlog — active, waiting, blocked, and unknown statuses all count as WIP).

### Throughput query

Count of distinct issues that transitioned to a DONE status during the week `[weekStart, weekEnd)`:

```sql
SELECT COUNT(DISTINCT issue_id) as count
FROM transitions
WHERE to_status IN ('Done', 'Finalizada')
  AND transitioned_at >= ?
  AND transitioned_at < ?
```

Params: `(weekStart, weekEnd)` where `weekEnd = weekStart + 7 days`.

### WIP snapshot query

Issues in an active state at the close of Sunday (end of week). For each issue, find its last transition at or before `weekEnd`, and check if `to_status` is not in EXCLUDED_STATUSES and not in TODO_STATUSES:

```sql
WITH last_before AS (
  SELECT issue_id, to_status,
    ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY transitioned_at DESC) AS rn
  FROM transitions
  WHERE transitioned_at < ?
)
SELECT COUNT(*) AS count
FROM last_before
WHERE rn = 1
  AND to_status NOT IN (/* WIP_EXCLUDED spread as ? placeholders */)
```

Param: `weekEnd` (exclusive upper bound = Monday of next week, i.e. `weekStart + 7 days`), then `...WIP_EXCLUDED`.

In code: `const wipExIn = WIP_EXCLUDED.map(() => '?').join(',')` and query uses `AND to_status NOT IN (${wipExIn})`.

### `isoMonday(date: Date): string`

Returns `YYYY-MM-DD` string of the Monday of the week containing `date`. Same UTC arithmetic as in `bottleneck.ts`:

```ts
function isoMonday(date: Date): string {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  const mon = new Date(date);
  mon.setUTCDate(date.getUTCDate() - diff);
  return mon.toISOString().slice(0, 10);
}
```

### Function signature

```ts
export function getComparison(
  db: Database.Database,
  opts: { week?: string; now?: Date } = {}
): ComparisonResult
```

- `opts.week` — ISO date string of the Monday to use as "current" week. Defaults to `isoMonday(opts.now ?? new Date())`.
- `opts.now` — injectable for tests.

### Delta computation

```ts
function period(current: number, previous: number): ComparisonPeriod {
  return {
    current,
    previous,
    delta: current - previous,
    deltaPct: previous === 0 ? null : Math.round((current - previous) / previous * 100),
  };
}
```

---

## Server: Route

In `server/src/routes/metrics.ts`:

```ts
import { getComparison } from '../services/comparison';

router.get('/comparison', (req, res, next) => {
  try {
    const week = typeof req.query.week === 'string' ? req.query.week : undefined;
    res.json(getComparison(getDb(), { week }));
  } catch (err) { next(err); }
});
```

---

## Server: Tests (`server/src/services/comparison.test.ts`)

Use in-memory SQLite (`applySchema` + seed data):

1. **Returns zero counts** when no transitions exist.
2. **Throughput** counts only transitions to Done/Finalizada in the correct week window, not the adjacent week.
3. **WIP snapshot** reflects the state of issues at end of Sunday — an issue that entered Done during the week is not counted as active WIP.
4. **deltaPct is null** when previous is 0.
5. **`opts.week` override** selects a past week correctly.

Route test in `server/src/routes/routes.test.ts`: add a describe block for `GET /api/metrics/comparison` verifying status 200, shape (`week`, `prevWeek`, `throughput.current ≥ 0`, `wip.current ≥ 0`).

---

## Client: `client/src/lib/api.ts`

```ts
export type { ComparisonResult, ComparisonPeriod } from '../../../server/src/types';

// in api object:
comparison: (week?: string) => get<ComparisonResult>(`/metrics/comparison${week ? `?week=${week}` : ''}`),
```

---

## Client: `client/src/hooks/useComparison.ts`

```ts
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

Re-fetches whenever `week` changes.

---

## Client: `client/src/components/Comparison/ComparisonCard.tsx`

**Presentational only** — receives `result: ComparisonResult | null`, `loading: boolean`, `week: string | undefined`, `setWeek: (w: string) => void`.

### Week selector

Dropdown (`<select>`) listing the last 12 ISO Mondays, formatted as `"23 jun – 29 jun"`. Computed at render time from `new Date()` walking back 12 weeks. Changing selection calls `setWeek(value)`.

### Metric blocks

Two blocks side by side (grid-cols-2):

**Each block shows:**
- Label (e.g. "Throughput" / "WIP al cierre")
- Current value — large, `text-slate-100`
- Delta arrow + number + percentage — color: `text-green-400` if delta > 0 for throughput (more done = good), `text-amber-400` if delta > 0 for WIP (more WIP = caution), `text-slate-400` if delta === 0
- Previous value — smaller, `text-slate-500`

Note: for WIP, higher is not necessarily better. Arrow color logic:
- Throughput ↑ → green; ↓ → red; = → slate
- WIP ↑ → amber (caution); ↓ → green (good); = → slate

### Insight line

Client-computed one-liner below the metric blocks. Logic:

```ts
function insight(r: ComparisonResult): string {
  const tUp = r.throughput.delta > 0;
  const tDown = r.throughput.delta < 0;
  const wUp = r.wip.delta > 0;
  const wDown = r.wip.delta < 0;

  if (tUp && wDown) return 'Buena semana: más entregas y menos trabajo en curso.';
  if (tUp && wUp)   return 'El throughput subió pero el WIP también — la velocidad de entrega no absorbió todo el trabajo nuevo.';
  if (tDown && wUp) return 'Semana difícil: menos entregas y más trabajo acumulado.';
  if (tDown && wDown) return 'Menos entregas, pero el WIP bajó — puede ser una semana de enfoque o depuración.';
  return 'Sin cambios significativos respecto a la semana anterior.';
}
```

### Loading state

Two `.animate-pulse` placeholder blocks.

### Empty state

If `result` is null and not loading: "Sin datos para la semana seleccionada."

---

## Client: Tests (`ComparisonCard.test.tsx`)

1. **Renders both metrics** — given a result, shows throughput and WIP values with delta.
2. **Insight line** — correct text for throughput ↑ + WIP ↑ case.
3. **Loading skeleton** — `loading=true` renders `.animate-pulse`, no metric values.
4. **Week selector** — changing the `<select>` calls `setWeek` with the chosen value.

---

## Client: `client/src/components/Comparison/Comparison.tsx`

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

`week === undefined` → hook uses server default (current week).

---

## Dashboard Placement (`client/src/App.tsx`)

Insert `<Comparison />` **above KPICards** (first element in the main grid):

```tsx
import { Comparison } from './components/Comparison/Comparison';

// ...

<Comparison />
<KPICards kpis={kpis} />
<CycleTimeByTalla data={byTalla} />
// ... rest unchanged
```

---

## Out of Scope

- Comparing non-consecutive weeks (always vs. immediately preceding)
- Cycle time or blocked count comparison (throughput + WIP only)
- Export or share
- Configurable active-status definition (dynamic exclusion via STATUS_CATEGORIES)
