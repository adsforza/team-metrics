# Bottleneck Detection — Design Spec

**Date:** 2026-06-27  
**Feature:** Detección de cuellos de botella entre estados (backlog item #2)

---

## Summary

Add a `BottleneckCard` component to the dashboard that shows, per Kanban state (all except Done/Cancelled), how many issues are queued and how long they take on average to flow through. Clicking any row opens a detail panel with 4 KPIs, top stalled issues, an 8-week trend chart, and avg time by talla.

---

## Design Decisions

| Question | Decision |
|---|---|
| Main view | Combined table: Estado · Cola · Tiempo medio · Score |
| Detail on click | Full panel: 4 KPIs + top issues table + 8-week trend + by talla |
| States shown | All except Done/Cancelled (actual status values, not categories) |
| Dashboard placement | After CFD+Scatter, before Throughput+AgingWIP |
| Time calculation | Combined: current queue size (live) + avg dwell time (historical, last 8 weeks) |

---

## Types (server/src/types.ts)

```ts
export type BottleneckScore = 'crítico' | 'alto' | 'medio' | 'normal';

export interface BottleneckTopIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  days_in_state: number;       // now − last transition TO this state
}

export interface BottleneckTallaBreakdown {
  talla: Talla;
  avg_days: number;
  count: number;               // historical samples in lookback window
}

export interface BottleneckWeekPoint {
  week: string;                // ISO date of Monday (YYYY-MM-DD)
  avg_days: number;
}

export interface BottleneckStateDetail {
  p85_days: number | null;
  pct_of_wip: number;          // BottleneckState.queue_size / BottleneckResult.total_active
  trend_pct: number | null;    // % change in avg_days: (last_week − first_week) / first_week; null if <2 data points
  trend: BottleneckWeekPoint[];
  top_issues: BottleneckTopIssue[];   // up to 8, sorted by days_in_state desc
  by_talla: BottleneckTallaBreakdown[];
}

export interface BottleneckState {
  status: string;              // raw Jira status name, e.g. "In Review"
  queue_size: number;
  avg_days: number | null;
  score: BottleneckScore;
  detail: BottleneckStateDetail;
}

export interface BottleneckResult {
  lookbackWeeks: number;       // 8
  total_active: number;        // total non-done issues, for pct_of_wip
  states: BottleneckState[];   // ordered by score severity then queue_size desc
}
```

---

## Server: `server/src/services/bottleneck.ts`

### Constants

```ts
const LOOKBACK_WEEKS = 8;
const LOOKBACK_DAYS = LOOKBACK_WEEKS * 7;   // 56
const TOP_ISSUES_LIMIT = 8;
const MIN_SAMPLES_FOR_AVG = 3;              // need ≥3 completed passes to compute avg
```

### States to include

All distinct `status` values currently in the issues table **except** those in `STATUS_CATEGORIES.done` and `STATUS_CATEGORIES.cancelled`. Query dynamically rather than from the static category list, so no-code status names (e.g. "In Review", "Ready for QA") are included automatically.

### Data queries (per state)

**Queue size** (`queue_size`): `SELECT COUNT(*) FROM issues WHERE status = ?` for each status in scope.

**Historical dwell time** (`avg_days`, `p85_days`): For each completed pass through a state in the lookback window:
- Entry event: a transition row where `to_status = state` with `transitioned_at >= now − 56d`
- Exit event: the earliest subsequent transition where `from_status = state` for the same issue
- `dwell_days = julianday(exited_at) − julianday(entered_at)`
- Collect all `dwell_days` values in JS, then `avg` and `percentile(arr, 85)` (reuse `percentile()` from `./stats`)
- Skip if fewer than `MIN_SAMPLES_FOR_AVG` complete passes

**Weekly trend** (`trend`): Same dwell time query, grouped by ISO week of `entered_at`, producing one `BottleneckWeekPoint` per week. Up to 8 weeks. Week label: Monday of that week as `YYYY-MM-DD`.

**Top issues** (`top_issues`): For each status, fetch current issues in that state with their `days_in_state = (now − latest transition TO that state)` in days. Sort descending, take up to 8.

**By talla** (`by_talla`): Same dwell times grouped by `issues.talla`, average per talla. Only include tallas with ≥1 sample.

### Score computation

After computing `queue_size` and `avg_days` for all states:

1. `q_norm[s] = queue_size[s] / max(all queue_sizes)` — normalise to 0..1
2. `t_norm[s]`:
   - If `avg_days[s]` is not null: `avg_days[s] / max(all non-null avg_days)` 
   - Else: `q_norm[s]` (fall back to queue pressure alone)
3. `combined[s] = 0.5 × q_norm[s] + 0.5 × t_norm[s]`
4. Sort all `combined` values, assign quartile ranks:
   - Top 25% → `crítico`
   - 25–50% → `alto`
   - 50–75% → `medio`
   - Bottom 25% → `normal`
   - If only 1 state: `normal`

### `trend_pct`

`(last_week.avg_days − first_week.avg_days) / first_week.avg_days * 100`. Null if trend has <2 points or first point is 0.

### Output ordering

States sorted by score severity (`crítico` > `alto` > `medio` > `normal`) then by `queue_size` descending within the same severity.

### Function signature

```ts
export function getBottleneck(
  db: Database.Database,
  opts: { now?: Date } = {}
): BottleneckResult
```

---

## Server: Route

In `server/src/routes/metrics.ts`:

```ts
router.get('/bottleneck', (_req, res, next) => {
  try { res.json(getBottleneck(getDb())); } catch (err) { next(err); }
});
```

No query params — always current, team-wide.

---

## Server: Tests (`server/src/services/bottleneck.test.ts`)

Tests use in-memory SQLite (`applySchema` + seed data):

1. **Returns empty states list** when no issues exist.
2. **Classifies `crítico` state** when queue is large and avg_days is high relative to others.
3. **`avg_days` is null** when fewer than `MIN_SAMPLES_FOR_AVG` complete passes exist for a state.
4. **`top_issues` ordered by days_in_state desc**, capped at 8.
5. **`trend` array** has correct week labels (Monday) and avg_days per week.
6. **`pct_of_wip`** = queue_size / total_active issues.

Route test in `server/src/routes/routes.test.ts`: add a describe block for `GET /api/metrics/bottleneck` verifying shape (`lookbackWeeks=8`, `total_active ≥ 0`, `Array.isArray(states)`, each state has `status`, `queue_size`, `score`, `detail`).

---

## Client: `client/src/lib/api.ts`

Add types export and method:

```ts
export type { BottleneckResult, BottleneckState, BottleneckStateDetail,
              BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint,
              BottleneckScore } from '../../../server/src/types';

// in api object:
bottleneck: () => get<BottleneckResult>('/metrics/bottleneck'),
```

---

## Client: `client/src/hooks/useBottleneck.ts`

Same pattern as `useWipRisk`: fetch on mount, active-flag cleanup, returns `{ result, loading }`.

```ts
export function useBottleneck(): { result: BottleneckResult | null; loading: boolean }
```

---

## Client: `client/src/components/Bottleneck/BottleneckCard.tsx`

**Presentational only** — receives `result: BottleneckResult | null` and `loading: boolean`.

### Main table

Columns: **Estado** · **Cola** · **Tiempo medio** · **Score**

- One row per state, sorted as returned by the API (severity desc)
- Score badge: `● Crítico` (red), `● Alto` (amber), `● Medio` (yellow), `● Normal` (slate)
- Clicking a row sets `selectedStatus` (local `useState`) and expands the detail panel inline below the row (not a modal)
- Clicking the selected row again collapses the panel
- Loading: skeleton rows with `animate-pulse`
- Empty: "Sin datos de estados activos"

### Detail panel (inline, below selected row)

Shown as an extra row spanning all columns, with the content from the design mockup:

**Row 1 — 4 KPIs** (grid-cols-4):
1. Issues ahora (`queue_size`)
2. Tiempo medio (`avg_days`, with `p85_days` as subtitle)
3. % del WIP total (`pct_of_wip` as percentage)
4. Tendencia (`trend_pct` with ↑/↓ arrow, or "—" if null)

**Row 2 — two columns**:

Left: "Issues con más tiempo en este estado" — table with Issue · Título · Talla · Días.  
- Color `days_in_state`: red if ≥`p85_days`, amber if ≥0.7×`p85_days`, else slate.
- If `p85_days` null: no color threshold, all slate.
- Shows up to 8 rows, then "+ N issues más" if `queue_size` > 8.

Right: "Tiempo medio en estado — últimas 8 semanas" — bar chart using `div` heights (same pattern as WipRiskCard ratio bars, no Recharts needed).  
- Bar color: red if last bar ≥ `p85_days`, amber if ≥ 0.7×`p85_days`, else blue/slate.
- Below the chart: "Por talla" horizontal bars (S/M/L/XL with avg_days label).

### Component file structure

```
client/src/components/Bottleneck/
  BottleneckCard.tsx       ← presentational + sub-components inline
  BottleneckCard.test.tsx  ← 3 tests (see below)
  Bottleneck.tsx           ← container (hook → card)
```

---

## Client: Tests (`BottleneckCard.test.tsx`)

1. **Renders table rows** — given `result` with 2 states, shows 2 rows with correct `status`, `queue_size`, `avg_days`, `score`.
2. **Expanding a row** — clicking a row shows the detail panel with 4 KPIs.
3. **Loading skeleton** — `loading=true` renders `.animate-pulse` elements, no table rows.

---

## Client: `client/src/components/Bottleneck/Bottleneck.tsx`

```tsx
export function Bottleneck() {
  const { result, loading } = useBottleneck();
  return <BottleneckCard result={result} loading={loading} />;
}
```

---

## Dashboard Placement (`client/src/App.tsx`)

Insert `<Bottleneck />` **after the CFD+Scatter grid, before the Throughput+AgingWIP grid**:

```tsx
<div className="grid grid-cols-5 gap-4">
  <div className="col-span-3"><CFDChart data={cfd} /></div>
  <div className="col-span-2"><ScatterPlot issues={issues} kpis={kpis} /></div>
</div>
<Bottleneck />                              {/* ← new */}
<div className="grid grid-cols-2 gap-4">
  <ThroughputChart data={throughput} />
  <AgingWIP issues={aging} />
</div>
```

---

## Out of Scope

- Filtering by assignee or date range (always team-wide, always current)
- Configurable lookback window (fixed at 8 weeks)
- Alert thresholds or notifications
- Drill-down to individual transitions history
