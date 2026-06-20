# Team Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-person `A/B/C/D` quartile score with four trend-based, polarity-aware
dimensions (Entrega, Predecibilidad, Foco, Flujo) plus a team-aggregate row, each shown vs. the
person's own previous window with the team median as context.

**Architecture:** A new self-contained server module `scorecard.ts` computes the four dimensions
per member (and for the whole team) over the selected window and the immediately preceding window,
returning a `TeamScorecardResponse`. `GET /api/team` returns this object instead of an array. The
client `TeamTable` is rewritten to render four dimension columns (value + trend arrow + context
bar) and a team-aggregate header row, via a new `DimensionCell` component.

**Tech Stack:** Node 20 + TypeScript + better-sqlite3 + Express (server); Vite + React 18 +
TypeScript + Tailwind (client). Tests: Vitest (+ supertest server, @testing-library/react client).

**Spec:** `docs/superpowers/specs/2026-06-19-team-performance-scorecard-design.md`

---

## File Structure

**Create:**
- `server/src/services/statusCategories.ts` — canonical status→category mapping + `categorize()`, `ACTIVE_STATUSES`, `DONE_STATUSES`.
- `server/src/services/stats.ts` — `percentile()`, `median()` (shared, pure).
- `server/src/services/scorecard.ts` — the four dimension computations + `getTeamScorecard()`.
- `server/src/services/statusCategories.test.ts`, `server/src/services/stats.test.ts`, `server/src/services/scorecard.test.ts`.
- `client/src/components/TeamTable/DimensionCell.tsx` + `DimensionCell.test.tsx`.

**Modify:**
- `server/src/types.ts` — add scorecard types; remove `PersonMetrics` (replaced).
- `server/src/routes/team.ts` — use `getTeamScorecard`.
- `server/src/services/metrics.ts` — remove `getTeamMetrics` (and its `Score` use).
- `server/src/routes/routes.test.ts` — update `/api/team` expectation to object shape.
- `client/src/lib/api.ts` — export new types; `team()` returns `TeamScorecardResponse`.
- `client/src/hooks/useTeam.ts` — adapt to new shape.
- `client/src/components/TeamTable/TeamTable.tsx` — rewrite columns + aggregate row.
- `client/src/lib/formatters.ts` — remove unused `SCORE_BG`.

---

## Task 1: Status categories helper

**Files:**
- Create: `server/src/services/statusCategories.ts`
- Test: `server/src/services/statusCategories.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/statusCategories.test.ts
import { describe, it, expect } from 'vitest';
import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories';

describe('categorize', () => {
  it('maps known statuses to categories', () => {
    expect(categorize('In Progress')).toBe('active');
    expect(categorize('EN CURSO')).toBe('active');
    expect(categorize('Blocked')).toBe('blocked');
    expect(categorize('Ready for Development')).toBe('waiting');
    expect(categorize('Done')).toBe('done');
    expect(categorize('Finalizada')).toBe('done');
    expect(categorize('Backlog')).toBe('todo');
    expect(categorize('Cancelado')).toBe('cancelled');
  });

  it('returns "unknown" for unmapped statuses', () => {
    expect(categorize('Some Custom Status')).toBe('unknown');
  });

  it('exposes active and done status lists', () => {
    expect(ACTIVE_STATUSES).toContain('In Progress');
    expect(DONE_STATUSES).toContain('Done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/statusCategories.test.ts`
Expected: FAIL — cannot find module `./statusCategories`.

- [ ] **Step 3: Write the implementation**

```ts
// server/src/services/statusCategories.ts
export const STATUS_CATEGORIES = {
  todo:      ['To Do', 'Tareas por hacer', 'Backlog', 'Por Hacer'],
  waiting:   ['Ready for Development', 'Prioritized', 'Committed', 'Prioritization', 'Ready for deploy'],
  active:    ['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development'],
  blocked:   ['Blocked'],
  done:      ['Done', 'Finalizada'],
  cancelled: ['Cancelled', 'Cancelado'],
} as const;

export type StatusCategory = keyof typeof STATUS_CATEGORIES | 'unknown';

export function categorize(status: string): StatusCategory {
  for (const [cat, list] of Object.entries(STATUS_CATEGORIES)) {
    if ((list as readonly string[]).includes(status)) return cat as StatusCategory;
  }
  return 'unknown';
}

export const ACTIVE_STATUSES: readonly string[] = STATUS_CATEGORIES.active;
export const DONE_STATUSES: readonly string[] = STATUS_CATEGORIES.done;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/statusCategories.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/statusCategories.ts server/src/services/statusCategories.test.ts
git commit -m "feat(server): canonical status category helper"
```

---

## Task 2: Stats helper (percentile, median)

**Files:**
- Create: `server/src/services/stats.ts`
- Test: `server/src/services/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/stats.test.ts
import { describe, it, expect } from 'vitest';
import { percentile, median } from './stats';

describe('percentile', () => {
  it('returns null for empty input', () => {
    expect(percentile([], 50)).toBeNull();
  });
  it('interpolates between values', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30], 85)).toBeCloseTo(27, 5);
  });
});

describe('median', () => {
  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
  });
  it('sorts before computing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/stats.test.ts`
Expected: FAIL — cannot find module `./stats`.

- [ ] **Step 3: Write the implementation**

```ts
// server/src/services/stats.ts
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return percentile(sorted, 50);
}
```

> Note: `percentile` expects an already-sorted array (same contract as the existing one in
> `metrics.ts`). `median` sorts internally.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/stats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/stats.ts server/src/services/stats.test.ts
git commit -m "feat(server): shared percentile/median stats helper"
```

---

## Task 3: Scorecard types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add the new types**

Append to `server/src/types.ts` (keep the existing `Talla`/`Score` exports):

```ts
export type Trend = 'up' | 'down' | 'flat';
export type Improving = 'better' | 'worse' | 'steady';

export interface DimensionValue {
  value: number | null;      // null = insufficient data
  previous: number | null;   // value over the immediately preceding window
  trend: Trend;              // raw direction of change
  improving: Improving;      // polarity-aware reading → drives color
}

export interface DimensionContext {
  min: number;
  median: number;
  max: number;
}

export interface ScorecardDimensions {
  delivery: DimensionValue;
  predictability: DimensionValue;
  focus: DimensionValue;
  flow: DimensionValue;
}

export interface PersonScorecard extends ScorecardDimensions {
  member: TeamMember;
}

export interface TeamScorecardResponse {
  team: ScorecardDimensions;
  members: PersonScorecard[];
  context: {
    delivery: DimensionContext;
    predictability: DimensionContext;
    focus: DimensionContext;
    flow: DimensionContext;
  };
}
```

- [ ] **Step 2: Remove the obsolete `PersonMetrics` interface**

Delete the `PersonMetrics` interface block from `server/src/types.ts`
(the one with `throughput`, `ct_p50`, `mix_tallas`, `blocked`, `score`, `sparkline`).
Leave `Score` and everything else in place — later tasks remove `Score`'s last usages.

- [ ] **Step 3: Verify the server still type-checks except for known break points**

Run: `cd server && npx tsc --noEmit`
Expected: errors ONLY in `metrics.ts` (getTeamMetrics) and `routes/team.ts` referencing the
removed `PersonMetrics`. These are fixed in Tasks 4–6. No other files should error.

- [ ] **Step 4: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): scorecard dimension types; drop PersonMetrics"
```

---

## Task 4: Scorecard service — dimension computations + aggregation

**Files:**
- Create: `server/src/services/scorecard.ts`

This task writes the full module. Its tests live in Task 5 (write Task 5's test file first if you
prefer strict TDD — it is designed to fail until this module exists).

- [ ] **Step 1: Write the implementation**

```ts
// server/src/services/scorecard.ts
import Database from 'better-sqlite3';
import { percentile, median } from './stats';
import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories';
import type {
  Talla, FilterParams, DimensionValue, DimensionContext,
  ScorecardDimensions, PersonScorecard, TeamScorecardResponse, Trend, Improving,
} from '../types';

const TALLA_WEIGHT: Record<Talla, number> = { S: 1, M: 2, L: 4, XL: 8 };
const TREND_EPS = 0.05;          // ±5% relative change counts as "flat"
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MIN_CT_DAYS = 1 / 24;      // discard batch-moves < 1h (same rule as metrics.ts)

// ---- window helpers (dates are 'YYYY-MM-DD') -------------------------------

interface Window { from: string; to: string }

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function diffDaysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY) + 1;
}

export function resolveWindows(params: FilterParams): { cur: Window; prev: Window } {
  const to = params.to ?? isoDate(new Date());
  const from = params.from ?? addDays(to, -27);   // default current window = last 28 days
  const len = diffDaysInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo } };
}

function eachDay(w: Window): string[] {
  const days: string[] = [];
  let cursor = w.from;
  while (cursor <= w.to) { days.push(cursor); cursor = addDays(cursor, 1); }
  return days;
}

// ---- data access -----------------------------------------------------------

interface CompletedIssue { issue_id: string; talla: Talla | null; start_at: string; end_at: string }

const activeIn = ACTIVE_STATUSES.map(() => '?').join(',');
const doneIn = DONE_STATUSES.map(() => '?').join(',');

function completedIssues(db: Database.Database, w: Window, assignee?: string): CompletedIssue[] {
  const rows = db.prepare(`
    SELECT i.id AS issue_id, i.talla AS talla,
           MIN(t_start.transitioned_at) AS start_at,
           t_end.transitioned_at        AS end_at
    FROM issues i
    JOIN transitions t_start ON t_start.issue_id = i.id AND t_start.to_status IN (${activeIn})
    JOIN transitions t_end   ON t_end.issue_id   = i.id AND t_end.to_status   IN (${doneIn})
    WHERE t_end.transitioned_at >= ? AND t_end.transitioned_at <= ?
      ${assignee ? 'AND i.assignee_id = ?' : ''}
    GROUP BY i.id, t_end.transitioned_at
  `).all(
    ...ACTIVE_STATUSES, ...DONE_STATUSES,
    w.from + 'T00:00:00Z', w.to + 'T23:59:59Z',
    ...(assignee ? [assignee] : []),
  ) as any[];
  return rows.map(r => ({ issue_id: r.issue_id, talla: r.talla, start_at: r.start_at, end_at: r.end_at }));
}

function cycleDays(i: CompletedIssue): number {
  return (new Date(i.end_at).getTime() - new Date(i.start_at).getTime()) / MS_PER_DAY;
}

// Active-time ratio for one issue, using its full transition timeline clipped to [start,end].
function activeRatio(i: CompletedIssue, transitions: { to_status: string; transitioned_at: string }[]): number | null {
  const startMs = new Date(i.start_at).getTime();
  const endMs = new Date(i.end_at).getTime();
  const total = endMs - startMs;
  if (total <= 0) return null;
  const ordered = [...transitions].sort((a, b) => a.transitioned_at.localeCompare(b.transitioned_at));
  let activeMs = 0;
  for (let k = 0; k < ordered.length; k++) {
    const segStart = Math.max(new Date(ordered[k].transitioned_at).getTime(), startMs);
    const segEnd = Math.min(k + 1 < ordered.length ? new Date(ordered[k + 1].transitioned_at).getTime() : endMs, endMs);
    if (segEnd > segStart && categorize(ordered[k].to_status) === 'active') activeMs += segEnd - segStart;
  }
  return activeMs / total;
}

function transitionsByIssue(db: Database.Database, ids: string[]): Map<string, { to_status: string; transitioned_at: string }[]> {
  const map = new Map<string, { to_status: string; transitioned_at: string }[]>();
  if (ids.length === 0) return map;
  const rows = db.prepare(`
    SELECT issue_id, to_status, transitioned_at FROM transitions
    WHERE issue_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as any[];
  for (const r of rows) {
    if (!map.has(r.issue_id)) map.set(r.issue_id, []);
    map.get(r.issue_id)!.push({ to_status: r.to_status, transitioned_at: r.transitioned_at });
  }
  return map;
}

function activeWipAt(db: Database.Database, day: string, assignee?: string): number {
  const at = day + 'T23:59:59Z';
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM issues i
    WHERE i.created_at <= ?
      ${assignee ? 'AND i.assignee_id = ?' : ''}
      AND COALESCE(
        (SELECT t.to_status FROM transitions t
         WHERE t.issue_id = i.id AND t.transitioned_at <= ?
         ORDER BY t.transitioned_at DESC LIMIT 1),
        i.status
      ) IN (${activeIn})
  `).get(at, ...(assignee ? [assignee] : []), at, ...ACTIVE_STATUSES) as any;
  return row.c;
}

// ---- the four dimensions ---------------------------------------------------

function delivery(db: Database.Database, w: Window, assignee?: string): number {
  return completedIssues(db, w, assignee)
    .reduce((sum, i) => sum + (i.talla ? TALLA_WEIGHT[i.talla] : 0), 0);
}

function predictability(db: Database.Database, w: Window, assignee?: string): number | null {
  const cts = completedIssues(db, w, assignee).map(cycleDays).filter(ct => ct >= MIN_CT_DAYS).sort((a, b) => a - b);
  if (cts.length < 2) return null;
  const p50 = percentile(cts, 50)!;
  const p85 = percentile(cts, 85)!;
  return p50 === 0 ? null : p85 / p50;
}

function focus(db: Database.Database, w: Window, assignee?: string): number {
  const days = eachDay(w);
  if (days.length === 0) return 0;
  return days.reduce((sum, d) => sum + activeWipAt(db, d, assignee), 0) / days.length;
}

function flow(db: Database.Database, w: Window, assignee?: string): number | null {
  const issues = completedIssues(db, w, assignee).filter(i => cycleDays(i) >= MIN_CT_DAYS);
  if (issues.length === 0) return null;
  const trans = transitionsByIssue(db, issues.map(i => i.issue_id));
  const ratios = issues
    .map(i => activeRatio(i, trans.get(i.issue_id) ?? []))
    .filter((r): r is number => r !== null);
  const m = median(ratios);
  return m === null ? null : m * 100;   // report as percentage
}

// ---- trend / context assembly ----------------------------------------------

export function makeDimension(current: number | null, previous: number | null, lowerIsBetter: boolean): DimensionValue {
  let trend: Trend = 'flat';
  let improving: Improving = 'steady';
  if (current !== null && previous !== null) {
    if (previous === 0) {
      if (current !== 0) { trend = 'up'; improving = lowerIsBetter ? 'worse' : 'better'; }
    } else {
      const rel = (current - previous) / Math.abs(previous);
      if (Math.abs(rel) > TREND_EPS) {
        trend = rel > 0 ? 'up' : 'down';
        const better = lowerIsBetter ? rel < 0 : rel > 0;
        improving = better ? 'better' : 'worse';
      }
    }
  }
  return { value: current, previous, trend, improving };
}

function contextOf(values: (number | null)[]): DimensionContext {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return { min: 0, median: 0, max: 0 };
  return { min: Math.min(...nums), median: median(nums)!, max: Math.max(...nums) };
}

function dimensionsFor(db: Database.Database, cur: Window, prev: Window, assignee?: string): ScorecardDimensions {
  return {
    delivery: makeDimension(delivery(db, cur, assignee), delivery(db, prev, assignee), false),
    predictability: makeDimension(predictability(db, cur, assignee), predictability(db, prev, assignee), true),
    focus: makeDimension(focus(db, cur, assignee), focus(db, prev, assignee), true),
    flow: makeDimension(flow(db, cur, assignee), flow(db, prev, assignee), false),
  };
}

export function getTeamScorecard(db: Database.Database, params: FilterParams): TeamScorecardResponse {
  const { cur, prev } = resolveWindows(params);
  const members = db.prepare('SELECT * FROM team_members ORDER BY display_name').all() as any[];

  const memberCards: PersonScorecard[] = members.map(m => ({
    member: m,
    ...dimensionsFor(db, cur, prev, m.id),
  }));

  const team = dimensionsFor(db, cur, prev);

  const context = {
    delivery: contextOf(memberCards.map(c => c.delivery.value)),
    predictability: contextOf(memberCards.map(c => c.predictability.value)),
    focus: contextOf(memberCards.map(c => c.focus.value)),
    flow: contextOf(memberCards.map(c => c.flow.value)),
  };

  return { team, members: memberCards, context };
}
```

- [ ] **Step 2: Verify it type-checks (in isolation)**

Run: `cd server && npx tsc --noEmit`
Expected: `scorecard.ts` itself has no errors. Pre-existing errors in `metrics.ts`/`team.ts`
(from Task 3) are still present — they are fixed in Tasks 5–6.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/scorecard.ts
git commit -m "feat(server): scorecard dimension computations and aggregation"
```

---

## Task 5: Scorecard service tests

**Files:**
- Create: `server/src/services/scorecard.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// server/src/services/scorecard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getTeamScorecard, makeDimension, resolveWindows } from './scorecard';

function seedMember(db: Database.Database, id: string, name: string) {
  db.prepare(`INSERT INTO team_members VALUES (?,?,?,null)`).run(id, name, `${id}@t.com`);
}

// Insert an issue plus its transitions. `transitions` = [to_status, ISO timestamp] pairs.
function seedIssue(
  db: Database.Database,
  id: string, assignee: string, talla: string | null, created: string,
  transitions: [string, string][],
) {
  const lastStatus = transitions.length ? transitions[transitions.length - 1][0] : 'To Do';
  const lastAt = transitions.length ? transitions[transitions.length - 1][1] : created;
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `Issue ${id}`, '', lastStatus, assignee, talla, 0.9, created, lastAt, '2026-06-20T00:00:00Z', lastAt,
  );
  for (const [to, at] of transitions) {
    db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
      .run(id, 'X', to, at);
  }
}

describe('makeDimension', () => {
  it('flags improvement vs. worsening with correct polarity', () => {
    // delivery: higher is better
    expect(makeDimension(14, 10, false)).toMatchObject({ trend: 'up', improving: 'better' });
    // focus: lower is better, so an increase is "worse"
    expect(makeDimension(4, 2, true)).toMatchObject({ trend: 'up', improving: 'worse' });
    // predictability: lower is better, a decrease is "better"
    expect(makeDimension(1.4, 2.0, true)).toMatchObject({ trend: 'down', improving: 'better' });
  });

  it('treats small relative changes as flat/steady', () => {
    expect(makeDimension(101, 100, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });

  it('is steady when there is no previous value', () => {
    expect(makeDimension(10, null, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });

  it('handles a zero baseline', () => {
    expect(makeDimension(5, 0, false)).toMatchObject({ trend: 'up', improving: 'better' });
    expect(makeDimension(0, 0, false)).toMatchObject({ trend: 'flat', improving: 'steady' });
  });
});

describe('resolveWindows', () => {
  it('builds an equal-length preceding window', () => {
    const { cur, prev } = resolveWindows({ from: '2026-06-08', to: '2026-06-14' }); // 7 days
    expect(cur).toEqual({ from: '2026-06-08', to: '2026-06-14' });
    expect(prev).toEqual({ from: '2026-06-01', to: '2026-06-07' });
  });
});

describe('getTeamScorecard', () => {
  let db: Database.Database;
  // current window: 2026-06-08..2026-06-14 ; previous: 2026-06-01..2026-06-07
  const params = { from: '2026-06-08', to: '2026-06-14' };

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    seedMember(db, 'u1', 'Ana');
  });

  it('weights delivery by talla over completed issues in the window', () => {
    // Two issues done in current window: one M (=2), one L (=4) → delivery 6
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    seedIssue(db, 'A-2', 'u1', 'L', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-11T09:00:00Z']]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].delivery.value).toBe(6);
    expect(sc.team.delivery.value).toBe(6);
  });

  it('returns null predictability/flow with insufficient data', () => {
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]);
    const sc = getTeamScorecard(db, params); // only 1 completed issue
    expect(sc.members[0].predictability.value).toBeNull();
    expect(sc.members[0].flow.value).not.toBeNull(); // flow needs only 1 issue
  });

  it('computes flow efficiency from active vs. blocked time', () => {
    // In Progress for 1 day, Blocked for 1 day, then Done → active ratio = 0.5 → 50%
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z', [
      ['In Progress', '2026-06-09T00:00:00Z'],
      ['Blocked', '2026-06-10T00:00:00Z'],
      ['Done', '2026-06-11T00:00:00Z'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).toBeCloseTo(50, 1);
  });

  it('builds team-median context across members', () => {
    seedMember(db, 'u2', 'Beto');
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]); // delivery 2
    seedIssue(db, 'B-1', 'u2', 'XL', '2026-06-08T00:00:00Z',
      [['In Progress', '2026-06-09T09:00:00Z'], ['Done', '2026-06-10T09:00:00Z']]); // delivery 8
    const sc = getTeamScorecard(db, params);
    expect(sc.context.delivery.min).toBe(2);
    expect(sc.context.delivery.max).toBe(8);
    expect(sc.context.delivery.median).toBe(5);
  });

  it('parses Jira timestamps with -0300 offset (no colon) without producing NaN', () => {
    seedIssue(db, 'A-1', 'u1', 'M', '2026-06-08T00:00:00-0300', [
      ['In Progress', '2026-06-09T09:00:00-0300'],
      ['Done', '2026-06-11T09:00:00-0300'],
    ]);
    const sc = getTeamScorecard(db, params);
    expect(sc.members[0].flow.value).not.toBeNull();
    expect(Number.isNaN(sc.members[0].flow.value as number)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd server && npx vitest run src/services/scorecard.test.ts`
Expected: PASS (all). If the `-0300` test fails with NaN, the parsing rule in the spec is being
violated somewhere — durations must be computed via `new Date(...)` in JS (as written in Task 4),
never via SQLite `date()`/`julianday()`.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/scorecard.test.ts
git commit -m "test(server): scorecard dimensions, trend polarity, context"
```

---

## Task 6: Wire the route + remove getTeamMetrics

**Files:**
- Modify: `server/src/routes/team.ts`
- Modify: `server/src/services/metrics.ts`
- Modify: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Update the failing route test**

In `server/src/routes/routes.test.ts`, replace the `describe('GET /api/team', ...)` array
assertion with the new object-shape assertion:

```ts
describe('GET /api/team', () => {
  it('returns 200 with scorecard shape', async () => {
    const res = await request(app).get('/api/team');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('team');
    expect(res.body).toHaveProperty('members');
    expect(res.body).toHaveProperty('context');
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.team).toHaveProperty('delivery');
  });
});
```

(Leave the `/api/team/members` test, if present, unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL — body is currently an array, so `toHaveProperty('team')` fails.

- [ ] **Step 3: Point the route at the new service**

Replace the import and handler in `server/src/routes/team.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../db/index';
import { getTeamScorecard } from '../services/scorecard';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const params: FilterParams = { from: req.query.from as string, to: req.query.to as string, talla: req.query.talla as string };
    res.json(getTeamScorecard(getDb(), params));
  } catch (err) {
    next(err);
  }
});

router.get('/members', (_req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM team_members ORDER BY display_name').all());
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Remove `getTeamMetrics` from metrics.ts**

In `server/src/services/metrics.ts`:
- Delete the entire `export function getTeamMetrics(...) { ... }` block (currently the last
  function in the file).
- Remove `PersonMetrics` and `Score` from the top `import type { ... } from '../types'` line
  (they are no longer referenced in this file). Keep the rest of the imports.

- [ ] **Step 5: Run the route test + full server suite**

Run: `cd server && npx vitest run`
Expected: PASS — all suites green (scorecard, stats, statusCategories, routes, sync, claude).

- [ ] **Step 6: Type-check the server**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/team.ts server/src/services/metrics.ts server/src/routes/routes.test.ts
git commit -m "feat(server): /api/team returns scorecard; remove quartile getTeamMetrics"
```

---

## Task 7: Client API + hook

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/hooks/useTeam.ts`

- [ ] **Step 1: Update the API client**

In `client/src/lib/api.ts`:
- Add the new types to the import-and-re-export from server types, and drop `PersonMetrics`:

```ts
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember } from '../../../server/src/types';

export type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember };
```

- Change the `team` method return type:

```ts
  team: (p: Record<string, string | undefined> = {}) => get<TeamScorecardResponse>('/team', p),
```

- [ ] **Step 2: Update the hook**

Replace `client/src/hooks/useTeam.ts` with:

```ts
import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { TeamScorecardResponse, TeamMember } from '../lib/api';

const EMPTY: TeamScorecardResponse = {
  team: {
    delivery: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    predictability: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    focus: { value: null, previous: null, trend: 'flat', improving: 'steady' },
    flow: { value: null, previous: null, trend: 'flat', improving: 'steady' },
  },
  members: [],
  context: {
    delivery: { min: 0, median: 0, max: 0 },
    predictability: { min: 0, median: 0, max: 0 },
    focus: { min: 0, median: 0, max: 0 },
    flow: { min: 0, median: 0, max: 0 },
  },
};

export function useTeam() {
  const filters = useFilters(s => ({ timeRange: s.timeRange, customFrom: s.customFrom, customTo: s.customTo, talla: s.talla }));
  const toQueryParams = useFilters(s => s.toQueryParams);
  const [scorecard, setScorecard] = useState<TeamScorecardResponse>(EMPTY);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to, talla } = toQueryParams();
    Promise.all([api.team({ from, to, talla }), api.teamMembers()])
      .then(([t, m]) => { setScorecard(t); setMembers(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters.timeRange, filters.customFrom, filters.customTo, filters.talla]);

  return { scorecard, members, loading };
}
```

- [ ] **Step 3: Commit** (the app won't type-check until Task 9 updates TeamTable; that's expected)

```bash
git add client/src/lib/api.ts client/src/hooks/useTeam.ts
git commit -m "feat(client): team API + hook return scorecard shape"
```

---

## Task 8: DimensionCell component

**Files:**
- Create: `client/src/components/TeamTable/DimensionCell.tsx`
- Test: `client/src/components/TeamTable/DimensionCell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/TeamTable/DimensionCell.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionCell } from './DimensionCell';
import type { DimensionValue, DimensionContext } from '../../lib/api';

const ctx: DimensionContext = { min: 0, median: 5, max: 10 };

describe('DimensionCell', () => {
  it('renders an em dash for null values', () => {
    const dim: DimensionValue = { value: null, previous: null, trend: 'flat', improving: 'steady' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the formatted value and an up arrow when trend is up', () => {
    const dim: DimensionValue = { value: 14, previous: 10, trend: 'up', improving: 'better' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByLabelText('mejora')).toBeInTheDocument();
  });

  it('labels a worsening trend distinctly from an improving one', () => {
    const dim: DimensionValue = { value: 4, previous: 2, trend: 'up', improving: 'worse' };
    render(<DimensionCell dim={dim} context={ctx} format={v => `${v}`} />);
    expect(screen.getByLabelText('empeora')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/components/TeamTable/DimensionCell.test.tsx`
Expected: FAIL — cannot find module `./DimensionCell`.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/TeamTable/DimensionCell.tsx
import type { DimensionValue, DimensionContext } from '../../lib/api';

const ARROW: Record<DimensionValue['trend'], string> = { up: '▲', down: '▼', flat: '=' };
const IMPROVING_CLASS: Record<DimensionValue['improving'], string> = {
  better: 'text-green-400',
  worse: 'text-amber-400',
  steady: 'text-slate-500',
};
const IMPROVING_LABEL: Record<DimensionValue['improving'], string> = {
  better: 'mejora',
  worse: 'empeora',
  steady: 'estable',
};

interface Props {
  dim: DimensionValue;
  context: DimensionContext;
  format: (value: number) => string;
}

export function DimensionCell({ dim, context, format }: Props) {
  if (dim.value === null) {
    return <td className="py-2.5 text-slate-600">—</td>;
  }

  // Position the value and the median marker on a 0..100% scale of [min,max].
  const span = context.max - context.min;
  const pct = (v: number) => (span === 0 ? 50 : ((v - context.min) / span) * 100);
  const fillPct = pct(dim.value);
  const medianPct = pct(context.median);

  return (
    <td className="py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-200 font-semibold tabular-nums">{format(dim.value)}</span>
        <span className={IMPROVING_CLASS[dim.improving]} aria-label={IMPROVING_LABEL[dim.improving]}>
          {ARROW[dim.trend]}
        </span>
      </div>
      <div className="relative h-1.5 w-14 bg-slate-700 rounded mt-1">
        <div className="absolute top-0 left-0 h-full bg-blue-500/60 rounded" style={{ width: `${fillPct}%` }} />
        <div className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-300 rounded" style={{ left: `${medianPct}%` }} />
      </div>
    </td>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd client && npx vitest run src/components/TeamTable/DimensionCell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TeamTable/DimensionCell.tsx client/src/components/TeamTable/DimensionCell.test.tsx
git commit -m "feat(client): DimensionCell — value + trend arrow + context bar"
```

---

## Task 9: Rewrite TeamTable

**Files:**
- Modify: `client/src/components/TeamTable/TeamTable.tsx`
- Test: `client/src/components/TeamTable/TeamTable.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/TeamTable/TeamTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamTable } from './TeamTable';
import type { TeamScorecardResponse } from '../../lib/api';

const dim = (value: number | null) => ({ value, previous: null, trend: 'flat' as const, improving: 'steady' as const });

const scorecard: TeamScorecardResponse = {
  team: { delivery: dim(11), predictability: dim(1.9), focus: dim(2.8), flow: dim(57) },
  members: [
    { member: { id: 'u1', display_name: 'Ana Gómez', email: 'a@t.com', avatar_url: null },
      delivery: dim(14), predictability: dim(1.4), focus: dim(2.1), flow: dim(68) },
  ],
  context: {
    delivery: { min: 0, median: 11, max: 14 },
    predictability: { min: 1.4, median: 1.9, max: 2.8 },
    focus: { min: 2.1, median: 2.8, max: 4.3 },
    flow: { min: 41, median: 57, max: 68 },
  },
};

describe('TeamTable', () => {
  it('renders a team aggregate row and one row per member', () => {
    render(<TeamTable scorecard={scorecard} loading={false} />);
    expect(screen.getByText('Equipo')).toBeInTheDocument();
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(screen.getByText('Predecibilidad')).toBeInTheDocument();
  });

  it('shows an empty state when there are no members', () => {
    render(<TeamTable scorecard={{ ...scorecard, members: [] }} loading={false} />);
    expect(screen.getByText('Sin datos de equipo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd client && npx vitest run src/components/TeamTable/TeamTable.test.tsx`
Expected: FAIL — `TeamTable` still expects the old `team: PersonMetrics[]` prop / `score` field.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `client/src/components/TeamTable/TeamTable.tsx` with:

```tsx
import type { TeamScorecardResponse, ScorecardDimensions, DimensionContext } from '../../lib/api';
import type { TeamMember } from '../../lib/api';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import { DimensionCell } from './DimensionCell';

const fmtInt = (v: number) => `${Math.round(v)}`;
const fmtRatio = (v: number) => v.toFixed(1);
const fmtPct = (v: number) => `${Math.round(v)}%`;

const COLUMNS = [
  { key: 'delivery' as const, label: 'Entrega', format: fmtInt,
    info: 'Throughput ponderado por talla (S=1, M=2, L=4, XL=8) de los issues que la persona llevó a Done en el rango. Más alto es mejor.' },
  { key: 'predictability' as const, label: 'Predecibilidad', format: fmtRatio,
    info: 'Qué tan consistente es su cycle time: ratio p85/p50. Cerca de 1 = entregas predecibles; alto = muy variable. Más bajo es mejor.' },
  { key: 'focus' as const, label: 'Foco', format: fmtRatio,
    info: 'WIP concurrente promedio: cuántos issues activos tuvo en paralelo. Más bajo = más enfocado.' },
  { key: 'flow' as const, label: 'Flujo', format: fmtPct,
    info: 'Flow efficiency: % del cycle time en que el trabajo avanzó (estados activos) vs. esperó o estuvo bloqueado. Más alto es mejor.' },
];

function Initials({ name }: { name: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-200 flex-shrink-0">
      {name.split(' ').map(n => n[0]).join('').slice(0, 2)}
    </div>
  );
}

interface Props {
  scorecard: TeamScorecardResponse;
  loading: boolean;
}

export function TeamTable({ scorecard, loading }: Props) {
  const { team, members, context } = scorecard;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rendimiento por persona</h3>
        <InfoTooltip text="Cuatro señales de flujo por persona. La flecha compara con el período anterior (verde = mejora, ámbar = empeora). La barrita ubica a la persona contra la mediana del equipo (marca clara), como contexto, no como ranking." />
      </div>
      <p className="text-xs text-slate-600 mb-4">Entrega · Predecibilidad · Foco · Flujo — tendencia vs. período anterior</p>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-700 rounded animate-pulse" />)}
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">Persona</th>
              {COLUMNS.map(col => (
                <th key={col.key} className="text-left pb-2">
                  <span className="inline-flex items-center gap-1">{col.label}<InfoTooltip text={col.info} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-700 bg-slate-900/40">
              <td className="py-2.5 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Equipo</td>
              {COLUMNS.map(col => (
                <DimensionCell key={col.key} dim={team[col.key]} context={context[col.key]} format={col.format} />
              ))}
            </tr>
            {members.map(p => (
              <tr key={p.member.id} className="border-t border-slate-700 hover:bg-slate-700/40">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Initials name={p.member.display_name} />
                    <div className="text-slate-200 font-medium">{p.member.display_name}</div>
                  </div>
                </td>
                {COLUMNS.map(col => (
                  <DimensionCell key={col.key} dim={(p as ScorecardDimensions)[col.key]} context={context[col.key]} format={col.format} />
                ))}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-4 text-center text-slate-600">Sin datos de equipo</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update the call site**

Find where `TeamTable` is rendered (search: `grep -rn "TeamTable" client/src/App.tsx client/src`).
Change the prop from `team={team}` to `scorecard={scorecard}` and update the destructure from
`useTeam()` accordingly (it now returns `{ scorecard, members, loading }`). Example:

```tsx
const { scorecard, loading } = useTeam();
// ...
<TeamTable scorecard={scorecard} loading={loading} />
```

- [ ] **Step 5: Run the component test**

Run: `cd client && npx vitest run src/components/TeamTable/TeamTable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TeamTable/TeamTable.tsx client/src/components/TeamTable/TeamTable.test.tsx client/src/App.tsx
git commit -m "feat(client): TeamTable shows 4-dimension scorecard + team aggregate row"
```

---

## Task 10: Cleanup + full verification

**Files:**
- Modify: `client/src/lib/formatters.ts`

- [ ] **Step 1: Remove the now-unused `SCORE_BG`**

In `client/src/lib/formatters.ts`, delete the `SCORE_BG` export and remove `Score` from the
`import type { Talla, Score } from '../../../server/src/types'` line (leave `Talla`).

- [ ] **Step 2: Confirm nothing else references removed symbols**

Run: `grep -rn "SCORE_BG\|PersonMetrics\|getTeamMetrics\|\.score\b" client/src server/src`
Expected: no matches (other than inside `.test` fixtures you intentionally kept, of which there
should be none). Fix any stragglers.

- [ ] **Step 3: Type-check both packages**

Run: `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 4: Run all tests**

Run: `cd server && npx vitest run && cd ../client && npx vitest run`
Expected: all green.

- [ ] **Step 5: Build the client**

Run: `cd client && npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 6: Manual smoke check**

Run `npm run dev` from the repo root, open the dashboard, and confirm the "Rendimiento por persona"
card shows the four dimension columns, a top "Equipo" row, trend arrows colored by improvement, and
context bars with a median marker. (Requires a populated `data/kanban.db`.)

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/formatters.ts
git commit -m "chore(client): drop unused SCORE_BG after scorecard migration"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** delivery/predictability/focus/flow → Tasks 4–5; trend polarity + flat
  threshold → `makeDimension` (Task 4/5); team median context → `contextOf` (Task 4/5);
  canonical status mapping → Task 1; JS-side duration parsing (Jira `-0300` bug) → Task 4 +
  guarded by a test in Task 5; UI Option A (value + arrow + context bar) → Tasks 8–9; team
  aggregate row → Task 9; InfoTooltip per dimension → Task 9; new `/api/team` contract → Tasks
  3, 6, 7; removal of A/B/C/D quartile scoring → Task 6 + Task 10.
- **Deferred (per spec):** the per-person expandable detail view with 6–8 week mini-charts is
  intentionally NOT in this plan.
- **Type consistency:** the hook returns `{ scorecard, members, loading }`; `TeamTable` takes
  `scorecard`; `DimensionCell` takes `{ dim, context, format }` — used identically in Tasks 8–9.
```
