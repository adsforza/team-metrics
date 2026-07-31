# SP1: Portable Metrics Core (vertical slice) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the compute logic of `metrics` (KPIs) and `scorecard` into a pure, portable `shared/core/` module (usable in Node and React Native), refactor the server to use it via a load/compute split, with **no behavior change**.

**Architecture:** `shared/core/` holds pure functions over in-memory arrays (`CoreIssue[]`, `CoreTransition[]`). The server keeps its SQL (`loadX`) and delegates computation to the core (`computeX`). Result types move to `core/types.ts`; `server/src/types.ts` re-exports them so existing server/client imports keep working.

**Tech Stack:** TypeScript, vitest. No new runtime deps. Core has zero Node built-ins, no `process.env`, no implicit `Date.now()` for windowed logic.

## Global Constraints

- `shared/core` MUST NOT import `better-sqlite3`, `fs`, `path`, any Node built-in, or read `process.env`.
- Values from the environment (e.g. `AGING_THRESHOLD_DAYS`) and "now" are passed as parameters.
- **No behavior change**: the 80 existing server tests must stay green unchanged.
- Preserve the exact status-name literal lists currently used (do NOT harmonize with `statusCategories` in SP1).
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Run server tests: `cd server && npx vitest run`. Run core tests: `cd shared/core && npx vitest run`.
- Typecheck: `npx tsc --noEmit`; if the mobile/`.bin/tsc` shim is broken use `node node_modules/typescript/lib/tsc.js --noEmit` (server's `.bin/tsc` works).

---

### Task 1: Scaffold `shared/core` + move stats & statusCategories

**Files:**
- Create: `shared/core/package.json`, `shared/core/tsconfig.json`, `shared/core/vitest.config.ts`
- Create: `shared/core/stats.ts`, `shared/core/statusCategories.ts`
- Create: `shared/core/stats.test.ts`, `shared/core/statusCategories.test.ts` (moved)
- Delete (after): `server/src/services/stats.ts`, `server/src/services/statusCategories.ts` and their tests — deferred to Task 4/6 to avoid breaking server imports mid-task; in Task 1 only CREATE the core copies.

**Interfaces:**
- Produces: `@teammetrics/core` module exporting `percentile`, `median` (from `stats`), `STATUS_CATEGORIES`, `categorize`, `ACTIVE_STATUSES`, `DONE_STATUSES` (from `statusCategories`).

- [ ] **Step 1: Create `shared/core/package.json`**

```json
{
  "name": "@teammetrics/core",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "index.ts",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^1.6.1", "typescript": "^5.4.0" }
}
```

- [ ] **Step 2: Create `shared/core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "noEmit": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create `shared/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Copy `stats.ts` and `statusCategories.ts` into the core verbatim**

Copy `server/src/services/stats.ts` → `shared/core/stats.ts` and `server/src/services/statusCategories.ts` → `shared/core/statusCategories.ts` with identical content (see current files). Do not modify logic.

- [ ] **Step 5: Copy their tests**

Copy `server/src/services/stats.test.ts` → `shared/core/stats.test.ts` and `server/src/services/statusCategories.test.ts` → `shared/core/statusCategories.test.ts`, fixing the import paths to `./stats` / `./statusCategories`.

- [ ] **Step 6: Install and run core tests**

Run: `cd shared/core && npm install && npx vitest run`
Expected: PASS (same counts as the originals — stats 4, statusCategories 3).

- [ ] **Step 7: Commit**

```bash
git add shared/core
git commit -m "feat(core): scaffold shared/core with stats and statusCategories"
```

---

### Task 2: Move I/O + result types to `shared/core/types.ts`, re-export from server

**Files:**
- Create: `shared/core/types.ts`
- Modify: `server/src/types.ts` (re-export moved types; keep server-only types local)

**Interfaces:**
- Produces (in `core/types.ts`): input types `CoreIssue`, `CoreTransition`, `CoreMember`, `CoreFilter`; result types `Talla`, `Trend`, `Improving`, `DimensionValue`, `DimensionContext`, `ScorecardDimensions`, `PersonScorecard`, `TeamScorecardResponse`, `KPIMetrics`, `FilterParams`.
- Consumed by: Tasks 3–6 (core) and the server (via re-export).

- [ ] **Step 1: Create `shared/core/types.ts`** with the input types and the moved result types.

```ts
export type Talla = 'S' | 'M' | 'L' | 'XL';

export interface CoreIssue {
  id: string; status: string; assignee_id: string | null;
  talla: Talla | null; created_at: string; last_transition_at: string | null;
}
export interface CoreTransition {
  issue_id: string; from_status: string | null; to_status: string; transitioned_at: string;
}
export interface CoreMember { id: string; display_name: string; email: string; avatar_url: string | null; }
export interface CoreFilter { assignee?: string; talla?: string; status?: string; from?: string; to?: string; }

export interface FilterParams { assignee?: string; talla?: string; status?: string; from?: string; to?: string; }
export interface KPIMetrics {
  wip: number; throughput: number;
  cycle_time_p50: number | null; cycle_time_p85: number | null; blocked_count: number;
}

export type Trend = 'up' | 'down' | 'flat';
export type Improving = 'better' | 'worse' | 'steady';
export interface DimensionValue { value: number | null; previous: number | null; trend: Trend; improving: Improving; }
export interface DimensionContext { min: number; median: number; max: number; }
export interface ScorecardDimensions {
  delivery: DimensionValue; predictability: DimensionValue; focus: DimensionValue;
  flow: DimensionValue; regressions: DimensionValue; blocked: DimensionValue;
}
export interface PersonScorecard extends ScorecardDimensions {
  member: { id: string; display_name: string; email: string; avatar_url: string | null };
}
export interface TeamScorecardResponse {
  team: ScorecardDimensions;
  members: PersonScorecard[];
  context: {
    delivery: DimensionContext; predictability: DimensionContext; focus: DimensionContext;
    flow: DimensionContext; regressions: DimensionContext; blocked: DimensionContext;
  };
}
```

- [ ] **Step 2: Re-export from `server/src/types.ts`**

Remove the local definitions of the types listed in Step 1 from `server/src/types.ts` and add, at the top, a re-export (keep all OTHER server-only types — e.g. `ForecastResult`, `WipRiskResult`, `BottleneckResult`, `ComparisonResult`, `Issue`, `TeamMember`, `TallaMetric`, `CFDPoint`, `ThroughputWeek`, `AgingIssue` — exactly as they are):

```ts
export type {
  Talla, FilterParams, KPIMetrics, Trend, Improving, DimensionValue, DimensionContext,
  ScorecardDimensions, PersonScorecard, TeamScorecardResponse,
} from '../../shared/core/types';
```

- [ ] **Step 3: Typecheck server + client**

Run: `cd server && npx tsc --noEmit` → Expected: no errors (pre-existing errors unrelated to this change are acceptable; there should be none in server).
Run: `cd client && npx tsc --noEmit` → Expected: no errors (client imports these via `../../../server/src/types`, still resolved through the re-export).

- [ ] **Step 4: Commit**

```bash
git add shared/core/types.ts server/src/types.ts
git commit -m "refactor(core): move I/O and result types to shared/core, re-export from server"
```

---

### Task 3: Port `computeKpis` into the core (TDD)

**Files:**
- Create: `shared/core/metrics.ts`, `shared/core/metrics.test.ts`

**Interfaces:**
- Consumes: `CoreIssue`, `CoreTransition`, `CoreFilter`, `KPIMetrics`, `Talla` from `./types`; `percentile` from `./stats`.
- Produces: `computeCycleTimes(issues, transitions, params) → number[]` (sorted asc) and `computeKpis(issues, transitions, params, agingThresholdDays, now?) → KPIMetrics`.

- [ ] **Step 1: Write the failing test** `shared/core/metrics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { computeKpis } from './metrics';
import type { CoreIssue, CoreTransition } from './types';

const iso = (d: string) => d; // timestamps are plain ISO strings

function issue(id: string, over: Partial<CoreIssue> = {}): CoreIssue {
  return { id, status: 'In Progress', assignee_id: 'u1', talla: 'M',
    created_at: '2026-06-01T00:00:00Z', last_transition_at: '2026-06-10T00:00:00Z', ...over };
}

describe('computeKpis', () => {
  it('counts wip, throughput, cycle time percentiles and blocked', () => {
    const issues: CoreIssue[] = [
      issue('A', { status: 'In Progress', last_transition_at: '2026-06-02T00:00:00Z' }), // active + stale
      issue('B', { status: 'Done' }),   // done → not wip
      issue('C', { status: 'To Do' }),  // excluded from wip
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'A', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-01T00:00:00Z' },
      { issue_id: 'B', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-08T00:00:00Z' },
      { issue_id: 'B', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-10T00:00:00Z' },
    ];
    const params = { from: '2026-06-01', to: '2026-06-30' };
    // now = 2026-06-20 → aging cutoff 7d = 2026-06-13; A last moved 06-02 → blocked; A is the only wip.
    const k = computeKpis(issues, transitions, params, 7, new Date('2026-06-20T00:00:00Z'));
    expect(k.wip).toBe(1);            // only A (B done, C to-do)
    expect(k.throughput).toBe(1);     // B done in window
    expect(k.blocked_count).toBe(1);  // A stale > 7d
    expect(k.cycle_time_p50).toBeCloseTo(2, 5); // B: 06-08 → 06-10 = 2 days
  });

  it('wip/throughput ignore talla/status filters but cycle times respect them', () => {
    // Documents that getKPIs applied assignee-only to wip/throughput/blocked.
    const issues: CoreIssue[] = [ issue('A', { talla: 'S', status: 'In Progress' }) ];
    const k = computeKpis(issues, [], { talla: 'XL' }, 7, new Date('2026-06-20T00:00:00Z'));
    expect(k.wip).toBe(1); // talla filter must NOT drop it from wip
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run metrics.test.ts`
Expected: FAIL ("computeKpis is not a function").

- [ ] **Step 3: Implement `shared/core/metrics.ts`**

Port of `server/src/services/metrics.ts` `getKPIs`/`getCycleTimes`, preserving the exact literal status lists and the assignee-only filtering of wip/throughput/blocked.

```ts
import { percentile } from './stats';
import type { CoreIssue, CoreTransition, CoreFilter, KPIMetrics } from './types';

const DONE = ['Done', 'Finalizada'];
const START = ['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development', 'To Do', 'TO DO', 'Tareas por hacer', 'Por Hacer', 'Backlog'];
const WIP_EXCLUDED = ['Done', 'Finalizada', 'Cancelled', 'Cancelado', 'To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'];
const MIN_DAYS: Record<string, number> = { XL: 1, L: 4 / 24, M: 1 / 24, S: 1 / 24 };
const MS_DAY = 1000 * 60 * 60 * 24;

function byId<T extends { issue_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { (m.get(r.issue_id) ?? m.set(r.issue_id, []).get(r.issue_id)!).push(r); }
  return m;
}

export function computeCycleTimes(issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter): number[] {
  const from = (params.from ?? '2000-01-01') + 'T00:00:00Z';
  const to = (params.to ?? '2099-12-31') + 'T23:59:59Z';
  const tallas = params.talla ? params.talla.split(',').map(t => t.trim()) : null;
  const statuses = params.status ? params.status.split(',').map(s => s.trim()) : null;
  const tByIssue = byId(transitions);

  const cts: number[] = [];
  for (const i of issues) {
    if (params.assignee && i.assignee_id !== params.assignee) continue;
    if (tallas && (!i.talla || !tallas.includes(i.talla))) continue;
    if (statuses && !statuses.includes(i.status)) continue;
    const ts = tByIssue.get(i.id) ?? [];
    const starts = ts.filter(t => START.includes(t.to_status)).map(t => t.transitioned_at);
    if (starts.length === 0) continue;
    const startAt = starts.reduce((a, b) => (a < b ? a : b));
    const ends = ts.filter(t => DONE.includes(t.to_status) && t.transitioned_at >= from && t.transitioned_at <= to);
    for (const end of ends) {
      const ct = (new Date(end.transitioned_at).getTime() - new Date(startAt).getTime()) / MS_DAY;
      if (ct >= (MIN_DAYS[i.talla ?? ''] ?? 1 / 24)) cts.push(ct);
    }
  }
  return cts.sort((a, b) => a - b);
}

export function computeKpis(
  issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter,
  agingThresholdDays: number, now: Date = new Date(),
): KPIMetrics {
  const from = (params.from ?? '2000-01-01') + 'T00:00:00Z';
  const to = (params.to ?? '2099-12-31') + 'T23:59:59Z';
  const byAssignee = (i: CoreIssue) => !params.assignee || i.assignee_id === params.assignee;

  const wip = issues.filter(i => byAssignee(i) && !WIP_EXCLUDED.includes(i.status)).length;

  const doneByIssue = byId(transitions.filter(t => DONE.includes(t.to_status) && t.transitioned_at >= from && t.transitioned_at <= to));
  const throughput = issues.filter(i => byAssignee(i) && doneByIssue.has(i.id)).length;

  const cutoff = new Date(now.getTime() - Math.max(1, agingThresholdDays) * MS_DAY).toISOString();
  const blocked_count = issues.filter(i =>
    byAssignee(i) && !WIP_EXCLUDED.includes(i.status) && (i.last_transition_at ?? '') <= cutoff
  ).length;

  const cts = computeCycleTimes(issues, transitions, params);
  return {
    wip, throughput,
    cycle_time_p50: percentile(cts, 50),
    cycle_time_p85: percentile(cts, 85),
    blocked_count,
  };
}
```

Note: the throughput count in `getKPIs` counts issues (not transitions); an issue with a Done transition in-window counts once — replicated via `doneByIssue.has(i.id)`. The `blocked_count` original compares `last_transition_at <= agingCutoff` in SQL string order; ISO UTC strings sort chronologically, so string `<=` matches. Timestamps with `-0300` offsets are compared as strings in the original SQL too, so keep string comparison for parity.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/core/metrics.ts shared/core/metrics.test.ts
git commit -m "feat(core): computeKpis + computeCycleTimes (pure port of getKPIs)"
```

---

### Task 4: Refactor server `getKPIs` to delegate to the core

**Files:**
- Modify: `server/src/services/metrics.ts` (getKPIs, getCycleTimes → load rows, call core)
- Delete: `server/src/services/stats.ts` + `stats.test.ts`, `server/src/services/statusCategories.ts` + `statusCategories.test.ts`; update remaining server imports (`scorecard.ts`, `bottleneck.ts`, etc.) to import from `../../../shared/core/stats` / `../../../shared/core/statusCategories`.

**Interfaces:**
- Consumes: `computeKpis`, `computeCycleTimes` from core; core `stats`/`statusCategories`.
- Produces: unchanged public API `getKPIs(db, params)`, `getCycleTimes(db, params)` (same return values).

- [ ] **Step 1: Add a loader and delegate in `metrics.ts`**

Replace the bodies of `getCycleTimes` and `getKPIs` so they load rows and call the core. Add a shared loader that maps DB rows to `CoreIssue`/`CoreTransition`:

```ts
import { computeKpis, computeCycleTimes } from '../../../shared/core/metrics';
import type { CoreIssue, CoreTransition } from '../../../shared/core/types';

function loadIssuesAndTransitions(db: Database.Database): { issues: CoreIssue[]; transitions: CoreTransition[] } {
  const issues = db.prepare(`SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues`).all() as CoreIssue[];
  const transitions = db.prepare(`SELECT issue_id, from_status, to_status, transitioned_at FROM transitions`).all() as CoreTransition[];
  return { issues, transitions };
}

export function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  return computeCycleTimes(issues, transitions, params);
}

export function getKPIs(db: Database.Database, params: FilterParams): KPIMetrics {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  const agingThreshold = Math.max(1, parseInt(process.env.AGING_THRESHOLD_DAYS ?? '7', 10) || 7);
  return computeKpis(issues, transitions, params, agingThreshold);
}
```

Remove the now-unused local `percentile` and `buildWhereClause` **only if** no other function in the file uses them; `getCycleTimeByTalla`, `getCFD`, `getThroughputWeekly`, `getAgingWIP` remain SQL-based in SP1, so keep whatever they still use. (`getCycleTimeByTalla` calls `getCycleTimes` and the local `percentile` — update it to import `percentile` from `../../../shared/core/stats`.)

- [ ] **Step 2: Repoint stats/statusCategories imports across the server**

Delete `server/src/services/stats.ts`, `stats.test.ts`, `statusCategories.ts`, `statusCategories.test.ts`. Then update every server file that imported them (e.g. `scorecard.ts`: `import { percentile, median } from './stats'` → `from '../../../shared/core/stats'`; `import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories'` → `from '../../../shared/core/statusCategories'`). Find them with: `grep -rl "from './stats'\|from './statusCategories'" server/src`.

- [ ] **Step 3: Run server tests**

Run: `cd server && npx vitest run`
Expected: all green. `metrics.test.ts` unchanged and passing proves no behavior change; total drops by the 7 moved stats/statusCategories tests (now in core) → expect 73 (was 80) unless those suites were counted elsewhere; the key check is **0 failures**.

- [ ] **Step 4: Typecheck server**

Run: `cd server && npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "refactor(server): getKPIs/getCycleTimes delegate to core; stats/statusCategories moved to core"
```

---

### Task 5: Port `computeScorecard` into the core (TDD)

**Files:**
- Create: `shared/core/scorecard.ts`, `shared/core/scorecard.test.ts`

**Interfaces:**
- Consumes: `CoreIssue`, `CoreTransition`, `CoreMember`, `CoreFilter`, and the scorecard result types from `./types`; `percentile`, `median` from `./stats`; `categorize`, `ACTIVE_STATUSES`, `DONE_STATUSES` from `./statusCategories`.
- Produces: `computeScorecard(issues, transitions, members, params, now?) → TeamScorecardResponse`; also re-export `makeDimension`, `resolveWindows` (used by existing server tests).

- [ ] **Step 1: Write the failing test** `shared/core/scorecard.test.ts`

Port the cases from `server/src/services/scorecard.test.ts` to call `computeScorecard` with in-memory arrays instead of a DB. Include: makeDimension polarity, resolveWindows, delivery weighting, member exclusion, flow efficiency, regressions/blocked percentages, talla filter. (Reuse the existing test bodies; replace `seedMember`/`seedIssue` with plain array construction and pass `now` where windows depend on it.)

```ts
import { describe, it, expect } from 'vitest';
import { computeScorecard, makeDimension, resolveWindows } from './scorecard';
import type { CoreIssue, CoreTransition, CoreMember } from './types';

// helper builders mirroring the old seedIssue/seedMember, producing CoreIssue[]/CoreTransition[]
// ... (full builders + the ported assertions from scorecard.test.ts) ...

describe('makeDimension', () => {
  it('flags improvement vs worsening with correct polarity', () => {
    expect(makeDimension(14, 10, false)).toMatchObject({ trend: 'up', improving: 'better' });
    expect(makeDimension(4, 2, true)).toMatchObject({ trend: 'up', improving: 'worse' });
  });
});
// ... remaining ported describes: resolveWindows, computeScorecard (delivery/exclusion/flow/regressions/blocked/talla) ...
```

The implementer must port ALL assertions currently in `server/src/services/scorecard.test.ts` so coverage is preserved in the core.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run scorecard.test.ts`
Expected: FAIL ("computeScorecard is not a function").

- [ ] **Step 3: Implement `shared/core/scorecard.ts`**

Port `server/src/services/scorecard.ts`. Keep the pure helpers as-is (`makeDimension`, `activeRatio`, `hasRegression` via `CATEGORY_RANK`+`categorize`, `contextOf`, `resolveWindows`, `eachDay`, `cycleDays`). Replace the three SQL data-access functions with in-memory equivalents over `CoreIssue[]`/`CoreTransition[]`:

- `completedIssues(issues, transitions, window, filter)`: for each issue passing the filter (assignee/assignees/tallas), compute start = MIN transition to an `ACTIVE_STATUSES` status, end = transition to a `DONE_STATUSES` status with `transitioned_at` in `[from,to]`; emit `{issue_id, talla, start_at, end_at}` per qualifying end.
- `activeWipAt(issues, transitions, day, filter)`: count issues (passing filter, `created_at <= dayEnd`) whose status at `day` (last transition ≤ `day+'T23:59:59Z'`, else `issue.status`) is in `ACTIVE_STATUSES`.
- `transitionsByIssue(transitions, ids)`: group into a Map.

`computeScorecard` mirrors `getTeamScorecard`: build per-member dimensions over `cur`/`prev` windows, filter to members with all four core indicators (`hasAllData`), team aggregate over included members, context bands. Signature:

```ts
export function computeScorecard(
  issues: CoreIssue[], transitions: CoreTransition[], members: CoreMember[],
  params: FilterParams, now: Date = new Date(),
): TeamScorecardResponse { /* ... */ }
```

`resolveWindows` uses `now` instead of `new Date()` when `params.to` is absent. (Full ported implementation — the implementer transcribes `scorecard.ts`, swapping the SQL helpers for the in-memory ones above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run scorecard.test.ts`
Expected: PASS (all ported cases).

- [ ] **Step 5: Commit**

```bash
git add shared/core/scorecard.ts shared/core/scorecard.test.ts
git commit -m "feat(core): computeScorecard (pure port of getTeamScorecard)"
```

---

### Task 6: Refactor server `getTeamScorecard` to delegate to the core

**Files:**
- Modify: `server/src/services/scorecard.ts` (reduce to a loader + delegation)
- Modify: `server/src/services/scorecard.test.ts` if it imports helpers now living only in core (`makeDimension`, `resolveWindows`) — repoint those imports to the core, OR keep thin server re-exports. Prefer: server `scorecard.ts` re-exports `makeDimension`, `resolveWindows` from core so the existing server test keeps importing from `./scorecard` unchanged.

**Interfaces:**
- Consumes: `computeScorecard` (+ `makeDimension`, `resolveWindows`) from core.
- Produces: unchanged `getTeamScorecard(db, params)` public API.

- [ ] **Step 1: Reduce `server/src/services/scorecard.ts` to loader + delegation**

```ts
import Database from 'better-sqlite3';
import { computeScorecard, makeDimension, resolveWindows } from '../../../shared/core/scorecard';
import type { CoreIssue, CoreTransition, CoreMember } from '../../../shared/core/types';
import type { FilterParams, TeamScorecardResponse } from '../types';

export { makeDimension, resolveWindows }; // keep existing test imports working

export function getTeamScorecard(db: Database.Database, params: FilterParams): TeamScorecardResponse {
  const issues = db.prepare(`SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues`).all() as CoreIssue[];
  const transitions = db.prepare(`SELECT issue_id, from_status, to_status, transitioned_at FROM transitions`).all() as CoreTransition[];
  const members = db.prepare(`SELECT id, display_name, email, avatar_url FROM team_members ORDER BY display_name`).all() as CoreMember[];
  return computeScorecard(issues, transitions, members, params);
}
```

- [ ] **Step 2: Run server tests**

Run: `cd server && npx vitest run`
Expected: all green (`scorecard.test.ts` unchanged, passing → proves no behavior change).

- [ ] **Step 3: Typecheck server + client**

Run: `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src
git commit -m "refactor(server): getTeamScorecard delegates to core computeScorecard"
```

---

### Task 7: Final verification

- [ ] **Step 1: Core tests**

Run: `cd shared/core && npx vitest run` → Expected: all green (stats, statusCategories, metrics, scorecard).

- [ ] **Step 2: Server suite + typecheck**

Run: `cd server && npx vitest run` → Expected: 0 failures.
Run: `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 3: No stray references**

Run: `grep -rn "from './stats'\|from './statusCategories'" server/src` → Expected: no matches (all repointed to core).

---

## Self-Review

**Spec coverage:**
- `shared/core` pure module, no Node built-ins / no `process.env` → Task 1 (scaffold rules) + Global Constraints. ✓
- Move stats/statusCategories → Tasks 1 & 4. ✓
- I/O + result types in core, re-export from server → Task 2. ✓
- `computeKpis` pure port + server delegation → Tasks 3 & 4. ✓
- `computeScorecard` pure port + server delegation → Tasks 5 & 6. ✓
- No behavior change verified by existing server tests → Tasks 4, 6, 7. ✓
- `now`/`agingThresholdDays` as params → Tasks 3 (computeKpis) & 5 (computeScorecard). ✓
- Preserve literal status lists → Task 3 impl note + Global Constraints. ✓

**Type consistency:** `CoreIssue`/`CoreTransition`/`CoreMember`/`CoreFilter`/`FilterParams` defined in Task 2, consumed identically in Tasks 3–6. `computeKpis(issues, transitions, params, agingThresholdDays, now?)` and `computeScorecard(issues, transitions, members, params, now?)` signatures consistent between core (Tasks 3/5) and server callers (Tasks 4/6).

**Placeholder scan:** Task 5 Step 1/Step 3 intentionally say "port ALL assertions" / "implementer transcribes" rather than inlining the full ~150 lines of scorecard + its test — the source files (`server/src/services/scorecard.ts`, `scorecard.test.ts`) are the exact reference and are cited by path. This is transcription of existing, verified code, not an undefined requirement.

**Out of scope (SP1):** other services, Jira client, classification, mobile wiring, workspaces, status-list harmonization.
