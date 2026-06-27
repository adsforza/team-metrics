# Bottleneck Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BottleneckCard` to the dashboard that shows per-state queue depth + avg dwell time, scores each state (crítico/alto/medio/normal), and expands inline to show KPIs, top stalled issues, 8-week trend, and breakdown by talla.

**Architecture:** New `getBottleneck()` service queries live issues for queue size and historical transitions for avg dwell time; scores states by quartile of a combined normalised metric; React card renders a click-to-expand table. Placed after CFD+Scatter in App.tsx.

**Tech Stack:** better-sqlite3 (server), Vitest + supertest (tests), React 18 + Tailwind CSS + @testing-library/react (client)

**Spec:** `docs/superpowers/specs/2026-06-27-bottleneck-detection-design.md`

---

## File Map

| Action | File |
|---|---|
| Modify | `server/src/types.ts` |
| Create | `server/src/services/bottleneck.ts` |
| Create | `server/src/services/bottleneck.test.ts` |
| Modify | `server/src/routes/metrics.ts` |
| Modify | `server/src/routes/routes.test.ts` |
| Modify | `client/src/lib/api.ts` |
| Create | `client/src/hooks/useBottleneck.ts` |
| Create | `client/src/components/Bottleneck/BottleneckCard.tsx` |
| Create | `client/src/components/Bottleneck/BottleneckCard.test.tsx` |
| Create | `client/src/components/Bottleneck/Bottleneck.tsx` |
| Modify | `client/src/App.tsx` |

---

## Task 1: Server Types

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1: Add 7 new types at the end of `server/src/types.ts`**

Append the following block after the last existing interface (`WipRiskResult`):

```ts
export type BottleneckScore = 'crítico' | 'alto' | 'medio' | 'normal';

export interface BottleneckTopIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  days_in_state: number;
}

export interface BottleneckTallaBreakdown {
  talla: Talla;
  avg_days: number;
  count: number;
}

export interface BottleneckWeekPoint {
  week: string;     // ISO date of Monday (YYYY-MM-DD)
  avg_days: number;
}

export interface BottleneckStateDetail {
  p85_days: number | null;
  pct_of_wip: number;        // state.queue_size / result.total_active
  trend_pct: number | null;  // % change from first to last trend point; null if <2 points
  trend: BottleneckWeekPoint[];
  top_issues: BottleneckTopIssue[];  // up to 8, sorted by days_in_state desc
  by_talla: BottleneckTallaBreakdown[];
}

export interface BottleneckState {
  status: string;
  queue_size: number;
  avg_days: number | null;  // avg dwell time from completed passes (last 8 weeks); null if <3 samples
  score: BottleneckScore;
  detail: BottleneckStateDetail;
}

export interface BottleneckResult {
  lookbackWeeks: number;   // 8
  total_active: number;
  states: BottleneckState[];  // sorted: severity desc, then queue_size desc
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
git commit -m "feat(bottleneck): add server types"
```

---

## Task 2: Bottleneck Service (TDD)

**Files:**
- Create: `server/src/services/bottleneck.test.ts`
- Create: `server/src/services/bottleneck.ts`

**Context:** Tests use in-memory SQLite (`new Database(':memory:')` + `applySchema`). `EXCLUDED_STATUSES` = `['Done','Finalizada','Cancelled','Cancelado']`. `MIN_SAMPLES_FOR_AVG = 3`.

- [ ] **Step 1: Create the test file** `server/src/services/bottleneck.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getBottleneck } from './bottleneck';

const NOW = new Date('2026-06-27T12:00:00Z');

let db: Database.Database;

// Insert a non-done issue currently in `status`, which entered it at `enteredAt`
function seedCurrent(id: string, status: string, enteredAt: string, talla: string | null = 'M') {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Issue ${id}`, '', status, 'u1', talla, 0.9,
        '2026-01-01T00:00:00Z', enteredAt, '2026-06-27T00:00:00Z', enteredAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', status, enteredAt);
}

// Insert a done issue that passed through `status` between enteredAt and exitedAt (completed pass)
function seedPass(id: string, status: string, enteredAt: string, exitedAt: string, talla: string = 'M') {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, `Done ${id}`, '', 'Done', 'u1', talla, 0.9,
        '2026-01-01T00:00:00Z', exitedAt, '2026-06-27T00:00:00Z', exitedAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'To Do', status, enteredAt);
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, status, 'Done', exitedAt);
}

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  db.prepare(`INSERT INTO team_members VALUES ('u1','Test','t@t.com',null)`).run();
});

describe('getBottleneck', () => {
  it('returns empty states when db has no active issues', () => {
    const r = getBottleneck(db, { now: NOW });
    expect(r.lookbackWeeks).toBe(8);
    expect(r.total_active).toBe(0);
    expect(r.states).toEqual([]);
  });

  it('assigns crítico to the state with highest combined queue and avg_days', () => {
    // "In Progress": 10 current + 5 passes of ~8d
    for (let i = 0; i < 10; i++) {
      seedCurrent(`ip-c${i}`, 'In Progress', '2026-06-20T00:00:00Z');
    }
    seedPass('ip-p0', 'In Progress', '2026-06-01T00:00:00Z', '2026-06-09T00:00:00Z'); // 8d
    seedPass('ip-p1', 'In Progress', '2026-06-03T00:00:00Z', '2026-06-11T00:00:00Z'); // 8d
    seedPass('ip-p2', 'In Progress', '2026-06-05T00:00:00Z', '2026-06-13T00:00:00Z'); // 8d
    seedPass('ip-p3', 'In Progress', '2026-06-07T00:00:00Z', '2026-06-15T00:00:00Z'); // 8d
    seedPass('ip-p4', 'In Progress', '2026-06-09T00:00:00Z', '2026-06-17T00:00:00Z'); // 8d

    // "To Do": 2 current + 5 passes of ~1d
    for (let i = 0; i < 2; i++) {
      seedCurrent(`td-c${i}`, 'To Do', '2026-06-25T00:00:00Z');
    }
    seedPass('td-p0', 'To Do', '2026-06-15T00:00:00Z', '2026-06-16T00:00:00Z'); // 1d
    seedPass('td-p1', 'To Do', '2026-06-16T00:00:00Z', '2026-06-17T00:00:00Z');
    seedPass('td-p2', 'To Do', '2026-06-17T00:00:00Z', '2026-06-18T00:00:00Z');
    seedPass('td-p3', 'To Do', '2026-06-18T00:00:00Z', '2026-06-19T00:00:00Z');
    seedPass('td-p4', 'To Do', '2026-06-19T00:00:00Z', '2026-06-20T00:00:00Z');

    const r = getBottleneck(db, { now: NOW });
    const ip = r.states.find(s => s.status === 'In Progress')!;
    const td = r.states.find(s => s.status === 'To Do')!;

    expect(ip).toBeDefined();
    expect(ip.score).toBe('crítico');
    expect(ip.avg_days).toBeCloseTo(8, 0);
    expect(td).toBeDefined();
    expect(td.score).not.toBe('crítico');
    // states sorted severity desc: In Progress first
    expect(r.states[0].status).toBe('In Progress');
  });

  it('sets avg_days to null when state has fewer than 3 completed passes', () => {
    seedCurrent('b1', 'Blocked', '2026-06-20T00:00:00Z');
    // Only 2 passes — below MIN_SAMPLES_FOR_AVG
    seedPass('bp0', 'Blocked', '2026-06-10T00:00:00Z', '2026-06-14T00:00:00Z'); // 4d
    seedPass('bp1', 'Blocked', '2026-06-14T00:00:00Z', '2026-06-17T00:00:00Z'); // 3d

    const r = getBottleneck(db, { now: NOW });
    const blocked = r.states.find(s => s.status === 'Blocked')!;
    expect(blocked.avg_days).toBeNull();
    expect(blocked.detail.p85_days).toBeNull();
  });

  it('orders top_issues by days_in_state descending and caps at 8', () => {
    // 10 issues in "In Review" with different entry times
    for (let i = 0; i < 10; i++) {
      // i=0 entered 20 days ago, i=9 entered 1 day ago
      const daysAgo = 20 - i * 2;
      const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
      seedCurrent(`ir-${i}`, 'In Review', d.toISOString());
    }

    const r = getBottleneck(db, { now: NOW });
    const ir = r.states.find(s => s.status === 'In Review')!;
    expect(ir.detail.top_issues.length).toBe(8);
    // First issue has most days_in_state
    expect(ir.detail.top_issues[0].days_in_state).toBeGreaterThan(
      ir.detail.top_issues[1].days_in_state,
    );
  });

  it('builds trend with correct ISO-Monday week labels', () => {
    // Seed current issue so state is included
    seedCurrent('ip-now', 'In Progress', '2026-06-25T00:00:00Z');
    // Three passes in different weeks (dates are Mondays of their respective weeks)
    // 2026-06-08 is a Monday (verified: Jun 1 is Mon, +7 = Jun 8)
    seedPass('tp0', 'In Progress', '2026-06-08T00:00:00Z', '2026-06-10T00:00:00Z'); // 2d, week=2026-06-08
    seedPass('tp1', 'In Progress', '2026-06-15T00:00:00Z', '2026-06-19T00:00:00Z'); // 4d, week=2026-06-15
    seedPass('tp2', 'In Progress', '2026-06-22T00:00:00Z', '2026-06-25T00:00:00Z'); // 3d, week=2026-06-22

    const r = getBottleneck(db, { now: NOW });
    const ip = r.states.find(s => s.status === 'In Progress')!;
    const { trend } = ip.detail;

    expect(trend.length).toBe(3);
    expect(trend[0].week).toBe('2026-06-08');
    expect(trend[1].week).toBe('2026-06-15');
    expect(trend[2].week).toBe('2026-06-22');
    expect(trend[0].avg_days).toBeCloseTo(2, 5);
    expect(trend[1].avg_days).toBeCloseTo(4, 5);
    expect(trend[2].avg_days).toBeCloseTo(3, 5);
  });

  it('computes pct_of_wip as queue_size / total_active', () => {
    seedCurrent('ip1', 'In Progress', '2026-06-20T00:00:00Z');
    seedCurrent('ip2', 'In Progress', '2026-06-21T00:00:00Z');
    seedCurrent('td1', 'To Do', '2026-06-25T00:00:00Z');
    // total_active = 3

    const r = getBottleneck(db, { now: NOW });
    expect(r.total_active).toBe(3);
    const ip = r.states.find(s => s.status === 'In Progress')!;
    expect(ip.detail.pct_of_wip).toBeCloseTo(2 / 3, 5);
    const td = r.states.find(s => s.status === 'To Do')!;
    expect(td.detail.pct_of_wip).toBeCloseTo(1 / 3, 5);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail (function not found)**

```bash
cd server && npx vitest run src/services/bottleneck.test.ts
```

Expected: all 6 tests fail with "Cannot find module './bottleneck'" or similar.

- [ ] **Step 3: Create the service** `server/src/services/bottleneck.ts`

```ts
import Database from 'better-sqlite3';
import { percentile } from './stats';
import { STATUS_CATEGORIES } from './statusCategories';
import type {
  Talla,
  BottleneckResult,
  BottleneckState,
  BottleneckStateDetail,
  BottleneckScore,
  BottleneckTopIssue,
  BottleneckTallaBreakdown,
  BottleneckWeekPoint,
} from '../types';

const LOOKBACK_WEEKS = 8;
const LOOKBACK_DAYS = LOOKBACK_WEEKS * 7;   // 56
const TOP_ISSUES_LIMIT = 8;
const MIN_SAMPLES_FOR_AVG = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];
const SEVERITY: Record<BottleneckScore, number> = { crítico: 3, alto: 2, medio: 1, normal: 0 };

const EXCLUDED = [...STATUS_CATEGORIES.done, ...STATUS_CATEGORIES.cancelled];
const excludedIn = EXCLUDED.map(() => '?').join(',');

function isoMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();              // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = (day + 6) % 7;         // days to subtract to reach Monday
  const monday = new Date(d.getTime() - daysBack * MS_PER_DAY);
  return monday.toISOString().slice(0, 10);
}

interface DwellRow {
  issue_id: string;
  status: string;
  entered_at: string;
  exited_at: string;
  talla: Talla | null;
}

interface ProcessedDwellRow {
  issue_id: string;
  status: string;
  entered_at: string;
  talla: Talla | null;
  dwell_days: number;
}

interface CurrentIssueRow {
  issue_id: string;
  title: string;
  talla: Talla | null;
  status: string;
  last_entry: string | null;
}

function getDwellRows(db: Database.Database, from: string): DwellRow[] {
  return db.prepare(`
    WITH e AS (
      SELECT t1.issue_id,
             t1.to_status        AS status,
             t1.transitioned_at  AS entered_at,
             (SELECT MIN(t2.transitioned_at)
              FROM   transitions t2
              WHERE  t2.issue_id    = t1.issue_id
                AND  t2.from_status = t1.to_status
                AND  t2.transitioned_at > t1.transitioned_at) AS exited_at
      FROM   transitions t1
      WHERE  t1.transitioned_at >= ?
        AND  t1.to_status NOT IN (${excludedIn})
    )
    SELECT e.issue_id, e.status, e.entered_at, e.exited_at, i.talla
    FROM   e
    JOIN   issues i ON i.id = e.issue_id
    WHERE  e.exited_at IS NOT NULL
    ORDER  BY e.status, e.entered_at
  `).all(from, ...EXCLUDED) as DwellRow[];
}

function getCurrentIssues(db: Database.Database): CurrentIssueRow[] {
  return db.prepare(`
    SELECT i.id AS issue_id, i.title, i.talla, i.status,
           MAX(t.transitioned_at) AS last_entry
    FROM   issues i
    LEFT JOIN transitions t ON t.issue_id = i.id AND t.to_status = i.status
    WHERE  i.status NOT IN (${excludedIn})
    GROUP  BY i.id
  `).all(...EXCLUDED) as CurrentIssueRow[];
}

function assignScores(combined: number[]): BottleneckScore[] {
  const n = combined.length;
  if (n === 0) return [];
  const indices = combined.map((_, i) => i).sort((a, b) => combined[b] - combined[a]);
  const scores = new Array<BottleneckScore>(n);
  indices.forEach((origIdx, rank) => {
    const q = rank / n;
    scores[origIdx] = q < 0.25 ? 'crítico' : q < 0.5 ? 'alto' : q < 0.75 ? 'medio' : 'normal';
  });
  return scores;
}

export function getBottleneck(
  db: Database.Database,
  opts: { now?: Date } = {},
): BottleneckResult {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const from = new Date(nowMs - LOOKBACK_DAYS * MS_PER_DAY).toISOString();

  const currentIssues = getCurrentIssues(db);
  const total_active = currentIssues.length;
  if (total_active === 0) return { lookbackWeeks: LOOKBACK_WEEKS, total_active: 0, states: [] };

  const dwellRows = getDwellRows(db, from);

  // Group by status
  const issuesByStatus = new Map<string, CurrentIssueRow[]>();
  for (const iss of currentIssues) {
    if (!issuesByStatus.has(iss.status)) issuesByStatus.set(iss.status, []);
    issuesByStatus.get(iss.status)!.push(iss);
  }

  const dwellByStatus = new Map<string, ProcessedDwellRow[]>();
  for (const row of dwellRows) {
    const dwell_days = (new Date(row.exited_at).getTime() - new Date(row.entered_at).getTime()) / MS_PER_DAY;
    if (dwell_days <= 0) continue;
    const processed: ProcessedDwellRow = { issue_id: row.issue_id, status: row.status, entered_at: row.entered_at, talla: row.talla, dwell_days };
    if (!dwellByStatus.has(row.status)) dwellByStatus.set(row.status, []);
    dwellByStatus.get(row.status)!.push(processed);
  }

  const statuses = [...issuesByStatus.keys()].sort();

  // Per-state avg/p85 (needed for score computation)
  const perState = statuses.map(status => {
    const dwells = (dwellByStatus.get(status) ?? []).map(d => d.dwell_days);
    const sorted = [...dwells].sort((a, b) => a - b);
    const avg_days = sorted.length >= MIN_SAMPLES_FOR_AVG
      ? sorted.reduce((s, v) => s + v, 0) / sorted.length
      : null;
    const p85_days = sorted.length >= MIN_SAMPLES_FOR_AVG
      ? percentile(sorted, 85)
      : null;
    return { status, queue_size: issuesByStatus.get(status)!.length, avg_days, p85_days };
  });

  // Score
  const maxQ = Math.max(...perState.map(p => p.queue_size), 1);
  const validAvgs = perState.map(p => p.avg_days).filter((v): v is number => v !== null);
  const maxT = validAvgs.length > 0 ? Math.max(...validAvgs, 0.001) : null;
  const combined = perState.map(p => {
    const qNorm = p.queue_size / maxQ;
    const tNorm = p.avg_days !== null && maxT !== null ? p.avg_days / maxT : qNorm;
    return 0.5 * qNorm + 0.5 * tNorm;
  });
  const scores = assignScores(combined);

  // Build full state objects
  const states: BottleneckState[] = perState.map(({ status, queue_size, avg_days, p85_days }, i) => {
    const score = scores[i];
    const issues = issuesByStatus.get(status)!;
    const dwells = dwellByStatus.get(status) ?? [];

    // top_issues
    const top_issues: BottleneckTopIssue[] = issues
      .map(iss => ({
        issue_id: iss.issue_id,
        title: iss.title,
        talla: iss.talla,
        days_in_state: iss.last_entry
          ? (nowMs - new Date(iss.last_entry).getTime()) / MS_PER_DAY
          : 0,
      }))
      .sort((a, b) => b.days_in_state - a.days_in_state)
      .slice(0, TOP_ISSUES_LIMIT);

    // trend
    const weekMap = new Map<string, number[]>();
    for (const d of dwells) {
      const week = isoMonday(d.entered_at);
      if (!weekMap.has(week)) weekMap.set(week, []);
      weekMap.get(week)!.push(d.dwell_days);
    }
    const trend: BottleneckWeekPoint[] = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-LOOKBACK_WEEKS)
      .map(([week, vals]) => ({
        week,
        avg_days: vals.reduce((s, v) => s + v, 0) / vals.length,
      }));

    const trend_pct =
      trend.length >= 2
        ? ((trend[trend.length - 1].avg_days - trend[0].avg_days) /
            Math.max(trend[0].avg_days, 0.001)) *
          100
        : null;

    // by_talla
    const tallaMap = new Map<Talla, number[]>();
    for (const d of dwells) {
      if (!d.talla) continue;
      if (!tallaMap.has(d.talla)) tallaMap.set(d.talla, []);
      tallaMap.get(d.talla)!.push(d.dwell_days);
    }
    const by_talla: BottleneckTallaBreakdown[] = TALLAS.filter(t => tallaMap.has(t)).map(t => {
      const vals = tallaMap.get(t)!;
      return { talla: t, avg_days: vals.reduce((s, v) => s + v, 0) / vals.length, count: vals.length };
    });

    const detail: BottleneckStateDetail = {
      p85_days,
      pct_of_wip: total_active > 0 ? queue_size / total_active : 0,
      trend_pct,
      trend,
      top_issues,
      by_talla,
    };

    return { status, queue_size, avg_days, score, detail };
  });

  // Sort severity desc, then queue_size desc
  states.sort((a, b) => {
    const sd = SEVERITY[b.score] - SEVERITY[a.score];
    return sd !== 0 ? sd : b.queue_size - a.queue_size;
  });

  return { lookbackWeeks: LOOKBACK_WEEKS, total_active, states };
}
```

- [ ] **Step 4: Run tests — verify all 6 pass**

```bash
cd server && npx vitest run src/services/bottleneck.test.ts
```

Expected: `6 passed`.

- [ ] **Step 5: Run full server test suite**

```bash
cd server && npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/bottleneck.ts server/src/services/bottleneck.test.ts
git commit -m "feat(bottleneck): service with dwell-time scoring and 8-week trend"
```

---

## Task 3: Route + Route Test

**Files:**
- Modify: `server/src/routes/metrics.ts`
- Modify: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Add import and route to `server/src/routes/metrics.ts`**

Add import after the `getWipRisk` import line:

```ts
import { getBottleneck } from '../services/bottleneck';
```

Add route after the `/wip-risk` route (before `export default router`):

```ts
router.get('/bottleneck', (_req, res, next) => {
  try { res.json(getBottleneck(getDb())); } catch (err) { next(err); }
});
```

- [ ] **Step 2: Add describe block to `server/src/routes/routes.test.ts`**

Append after the last `describe` block in the file:

```ts
describe('GET /api/metrics/bottleneck', () => {
  it('returns 200 with BottleneckResult shape', async () => {
    const res = await request(app).get('/api/metrics/bottleneck');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lookbackWeeks', 8);
    expect(typeof res.body.total_active).toBe('number');
    expect(Array.isArray(res.body.states)).toBe(true);
    // The mock DB has 1 issue in 'In Progress' (seeded at top of routes.test.ts)
    if (res.body.states.length > 0) {
      const s = res.body.states[0];
      expect(s).toHaveProperty('status');
      expect(s).toHaveProperty('queue_size');
      expect(s).toHaveProperty('score');
      expect(s).toHaveProperty('detail');
      expect(Array.isArray(s.detail.top_issues)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run full server test suite**

```bash
cd server && npm test
```

Expected: all tests pass including the new route test.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/metrics.ts server/src/routes/routes.test.ts
git commit -m "feat(bottleneck): add GET /api/metrics/bottleneck route"
```

---

## Task 4: Client API Types + Method

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Update the import line** (first line of `client/src/lib/api.ts`)

Replace the existing import with:

```ts
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore } from '../../../server/src/types';
```

- [ ] **Step 2: Update the export line** (second line of `client/src/lib/api.ts`)

Replace with:

```ts
export type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore };
```

- [ ] **Step 3: Add `bottleneck` method to the `api` object** (after `wipRisk` line)

```ts
bottleneck: () => get<BottleneckResult>('/metrics/bottleneck'),
```

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(bottleneck): add client API types and bottleneck() method"
```

---

## Task 5: useBottleneck Hook

**Files:**
- Create: `client/src/hooks/useBottleneck.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BottleneckResult } from '../lib/api';

export function useBottleneck() {
  const [result, setResult] = useState<BottleneckResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.bottleneck()
      .then(r => { if (active) { setResult(r); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

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
git add client/src/hooks/useBottleneck.ts
git commit -m "feat(bottleneck): add useBottleneck hook"
```

---

## Task 6: BottleneckCard Component + Tests

**Files:**
- Create: `client/src/components/Bottleneck/BottleneckCard.tsx`
- Create: `client/src/components/Bottleneck/BottleneckCard.test.tsx`

- [ ] **Step 1: Create the test file** `client/src/components/Bottleneck/BottleneckCard.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottleneckCard } from './BottleneckCard';
import type { BottleneckResult } from '../../lib/api';

const fixture: BottleneckResult = {
  lookbackWeeks: 8,
  total_active: 15,
  states: [
    {
      status: 'In Review',
      queue_size: 10,
      avg_days: 6.1,
      score: 'crítico',
      detail: {
        p85_days: 14.2,
        pct_of_wip: 10 / 15,
        trend_pct: 97,
        trend: [
          { week: '2026-06-08', avg_days: 3.1 },
          { week: '2026-06-15', avg_days: 4.5 },
          { week: '2026-06-22', avg_days: 6.1 },
        ],
        top_issues: [
          { issue_id: 'OPS-1133', title: 'Token solo lectura', talla: 'M', days_in_state: 21 },
          { issue_id: 'OPS-2041', title: 'Migrar auth OAuth2', talla: 'L', days_in_state: 18 },
        ],
        by_talla: [
          { talla: 'M', avg_days: 5.1, count: 3 },
          { talla: 'L', avg_days: 8.4, count: 2 },
        ],
      },
    },
    {
      status: 'To Do',
      queue_size: 5,
      avg_days: 1.0,
      score: 'normal',
      detail: {
        p85_days: 2.0,
        pct_of_wip: 5 / 15,
        trend_pct: null,
        trend: [],
        top_issues: [],
        by_talla: [],
      },
    },
  ],
};

describe('BottleneckCard', () => {
  it('renders one row per state with correct status, queue, avg_days, and score', () => {
    render(<BottleneckCard result={fixture} loading={false} />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('● crítico')).toBeInTheDocument();
    expect(screen.getByText('● normal')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('6.1d')).toBeInTheDocument();
  });

  it('expands detail panel on row click and collapses on second click', () => {
    render(<BottleneckCard result={fixture} loading={false} />);
    const row = screen.getByText('In Review').closest('tr')!;

    fireEvent.click(row);
    expect(screen.getByText('OPS-1133')).toBeInTheDocument();
    expect(screen.getByText('Issues con más tiempo aquí')).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText('OPS-1133')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton when loading=true', () => {
    const { container } = render(<BottleneckCard result={null} loading={true} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify all 3 fail**

```bash
cd client && npx vitest run src/components/Bottleneck/BottleneckCard.test.tsx
```

Expected: FAIL — component file doesn't exist yet.

- [ ] **Step 3: Create the component** `client/src/components/Bottleneck/BottleneckCard.tsx`

```tsx
import { Fragment, useState } from 'react';
import type { BottleneckResult, BottleneckState, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore } from '../../lib/api';
import type { Talla } from '../../../../server/src/types';
import { TALLA_BG } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

const SCORE_CLASS: Record<BottleneckScore, string> = {
  crítico: 'text-red-400',
  alto:    'text-amber-400',
  medio:   'text-yellow-400',
  normal:  'text-slate-400',
};

function ScoreBadge({ score }: { score: BottleneckScore }) {
  return <span className={`font-medium ${SCORE_CLASS[score]}`}>● {score}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-200">{value}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function TrendChart({ trend, p85_days }: { trend: BottleneckWeekPoint[]; p85_days: number | null }) {
  if (trend.length === 0) return <p className="text-slate-600 text-[11px]">Sin datos históricos</p>;
  const maxAvg = Math.max(...trend.map(w => w.avg_days), 0.001);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 80 }}>
      {trend.map(w => {
        const heightPct = (w.avg_days / maxAvg) * 100;
        const isHigh = p85_days !== null && w.avg_days >= p85_days;
        const isMid  = p85_days !== null && w.avg_days >= p85_days * 0.7;
        const barColor = isHigh ? 'bg-red-500' : isMid ? 'bg-amber-500' : 'bg-blue-500/70';
        const label = new Date(w.week).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        return (
          <div key={w.week} className="flex flex-col items-center gap-0.5 flex-1 h-full justify-end">
            <span className="text-[8px] text-slate-500 leading-none">{w.avg_days.toFixed(1)}d</span>
            <div className={`w-full rounded-t ${barColor}`} style={{ height: `${heightPct}%` }} />
            <span className="text-[7px] text-slate-600" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: 28, lineHeight: 1 }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ByTalla({ by_talla }: { by_talla: BottleneckTallaBreakdown[] }) {
  if (by_talla.length === 0) return null;
  const maxAvg = Math.max(...by_talla.map(b => b.avg_days), 0.001);
  return (
    <div className="space-y-1.5">
      {by_talla.map(bt => (
        <div key={bt.talla} className="flex items-center gap-2">
          <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-black w-6 text-center ${TALLA_BG[bt.talla as Talla]}`}>
            {bt.talla}
          </span>
          <div className="flex-1 h-1.5 bg-slate-700 rounded overflow-hidden">
            <div className="h-full bg-blue-400/70 rounded" style={{ width: `${(bt.avg_days / maxAvg) * 100}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 w-10 text-right">{bt.avg_days.toFixed(1)}d</span>
        </div>
      ))}
    </div>
  );
}

function TopIssuesTable({
  top_issues,
  queue_size,
  p85_days,
}: {
  top_issues: BottleneckTopIssue[];
  queue_size: number;
  p85_days: number | null;
}) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-500 text-[10px]">
          <th className="text-left pb-1 pr-2">Issue</th>
          <th className="text-left pb-1 pr-2">Título</th>
          <th className="text-left pb-1 pr-2">Talla</th>
          <th className="text-right pb-1">Días</th>
        </tr>
      </thead>
      <tbody>
        {top_issues.map(iss => {
          const daysClass =
            p85_days !== null
              ? iss.days_in_state >= p85_days
                ? 'text-red-400 font-bold'
                : iss.days_in_state >= p85_days * 0.7
                ? 'text-amber-400'
                : 'text-slate-300'
              : 'text-slate-300';
          return (
            <tr key={iss.issue_id} className="border-t border-slate-800">
              <td className="py-1 text-blue-400 font-mono pr-2">{iss.issue_id}</td>
              <td className="py-1 text-slate-400 truncate max-w-[110px] pr-2">{iss.title}</td>
              <td className="py-1 pr-2">
                {iss.talla && (
                  <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-black ${TALLA_BG[iss.talla as Talla]}`}>
                    {iss.talla}
                  </span>
                )}
              </td>
              <td className={`py-1 text-right ${daysClass}`}>{iss.days_in_state.toFixed(1)}d</td>
            </tr>
          );
        })}
        {queue_size > top_issues.length && (
          <tr className="border-t border-slate-800">
            <td colSpan={4} className="py-1 text-center text-slate-600 text-[10px] italic">
              + {queue_size - top_issues.length} issues más
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function DetailPanel({ state }: { state: BottleneckState }) {
  const { queue_size, avg_days, detail } = state;
  const { p85_days, pct_of_wip, trend_pct, trend, top_issues, by_talla } = detail;

  const trendLabel =
    trend_pct !== null
      ? `${trend_pct > 0 ? '↑' : '↓'}${Math.abs(trend_pct).toFixed(0)}%`
      : '—';

  return (
    <div className="p-4 bg-slate-900 space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Issues ahora" value={String(queue_size)} />
        <Kpi
          label="Tiempo medio"
          value={avg_days !== null ? `${avg_days.toFixed(1)}d` : '—'}
          sub={p85_days !== null ? `p85: ${p85_days.toFixed(1)}d` : undefined}
        />
        <Kpi label="% del WIP" value={`${(pct_of_wip * 100).toFixed(0)}%`} />
        <Kpi label="Tendencia 8 sem" value={trendLabel} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
            Issues con más tiempo aquí
          </p>
          <TopIssuesTable top_issues={top_issues} queue_size={queue_size} p85_days={p85_days} />
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
              Tiempo medio — últimas 8 semanas
            </p>
            <TrendChart trend={trend} p85_days={p85_days} />
          </div>
          {by_talla.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
                Tiempo medio por talla
              </p>
              <ByTalla by_talla={by_talla} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  result: BottleneckResult | null;
  loading: boolean;
}

export function BottleneckCard({ result, loading }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (status: string) => setSelected(prev => (prev === status ? null : status));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Cuellos de Botella
        </h3>
        <InfoTooltip text="Estados del flujo con mayor acumulación de issues y/o tiempo de espera. Score: 0.5×cola_normalizada + 0.5×tiempo_normalizado, por quartil (crítico/alto/medio/normal). Lookback: 8 semanas." />
      </div>

      {loading || !result ? (
        <div className="h-32 bg-slate-700/40 rounded animate-pulse" />
      ) : result.states.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-6">Sin datos de estados activos</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">Estado</th>
              <th className="text-right pb-2">Cola</th>
              <th className="text-right pb-2">Tiempo medio</th>
              <th className="text-right pb-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {result.states.map(state => (
              <Fragment key={state.status}>
                <tr
                  className="border-t border-slate-700 hover:bg-slate-700/40 cursor-pointer"
                  onClick={() => toggle(state.status)}
                >
                  <td className="py-2 text-slate-200">{state.status}</td>
                  <td className="py-2 text-right text-slate-300">{state.queue_size}</td>
                  <td className="py-2 text-right text-slate-300">
                    {state.avg_days !== null ? `${state.avg_days.toFixed(1)}d` : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <ScoreBadge score={state.score} />
                  </td>
                </tr>
                {selected === state.status && (
                  <tr className="border-t border-slate-700">
                    <td colSpan={4} className="p-0">
                      <DetailPanel state={state} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — verify all 3 pass**

```bash
cd client && npx vitest run src/components/Bottleneck/BottleneckCard.test.tsx
```

Expected: `3 passed`.

- [ ] **Step 5: Run full client test suite**

```bash
cd client && npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Bottleneck/BottleneckCard.tsx client/src/components/Bottleneck/BottleneckCard.test.tsx
git commit -m "feat(bottleneck): add BottleneckCard presentational component"
```

---

## Task 7: Bottleneck Container + Dashboard Mount

**Files:**
- Create: `client/src/components/Bottleneck/Bottleneck.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the container** `client/src/components/Bottleneck/Bottleneck.tsx`

```tsx
import { useBottleneck } from '../../hooks/useBottleneck';
import { BottleneckCard } from './BottleneckCard';

export function Bottleneck() {
  const { result, loading } = useBottleneck();
  return <BottleneckCard result={result} loading={loading} />;
}
```

- [ ] **Step 2: Add import to `client/src/App.tsx`**

Add after the `WipRisk` import line:

```ts
import { Bottleneck } from './components/Bottleneck/Bottleneck';
```

- [ ] **Step 3: Mount in `client/src/App.tsx`**

Find the CFD+Scatter grid block:

```tsx
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3"><CFDChart data={cfd} /></div>
          <div className="col-span-2"><ScatterPlot issues={issues} kpis={kpis} /></div>
        </div>
```

Insert `<Bottleneck />` immediately after that closing `</div>`:

```tsx
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3"><CFDChart data={cfd} /></div>
          <div className="col-span-2"><ScatterPlot issues={issues} kpis={kpis} /></div>
        </div>
        <Bottleneck />
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
git add client/src/components/Bottleneck/Bottleneck.tsx client/src/App.tsx
git commit -m "feat(bottleneck): mount Bottleneck card after CFD+Scatter in dashboard"
```
