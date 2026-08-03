# SP4c-0: Port remaining metrics to core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the 8 remaining metric functions (throughput, CFD, aging, by-talla, forecast, bottleneck, wipRisk, comparison) into `shared/core` using the SP1 load/compute pattern, server delegating, with **no behavior change**.

**Architecture:** For each function, the pure computation moves to `shared/core/<name>.ts` operating on in-memory `CoreIssue[]`/`CoreTransition[]`; the server keeps a `loadX(db)` (SQL) and calls `computeX`. Result types move to `shared/core/types.ts`, re-exported from `server/src/types.ts`. Existing server tests are the parity gate.

**Tech Stack:** TypeScript, vitest. Core: no `better-sqlite3`, no `process.env`, no implicit `Date.now()`/`Math.random()` (pass `now`/`rng`).

## Global Constraints

- Core purity: no Node built-ins, no `process.env`; `now`/`rng` are parameters.
- **No behavior change**: the server test for each ported function passes UNCHANGED. This is the primary gate.
- Preserve exact semantics incl. literal status lists and string/lexicographic timestamp comparisons (SQLite TEXT semantics), as done for scorecard in SP1.
- Reuse existing core helpers: `shared/core/stats`, `shared/core/statusCategories`, `computeCycleTimes` (from `shared/core/metrics`). If window helpers (`eachDay`, `addDays`, `isoDate`) are needed by more than one, export them from where they live (scorecard) or a small `shared/core/windows.ts` — implementer's judgment, keep it DRY.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Core tests: `cd shared/core && npx vitest run`. Server: `cd server && npx vitest run`.

---

### Task 1: Move result types to core + re-export from server

**Files:** Modify `shared/core/types.ts`, `server/src/types.ts`.

**Interfaces:** Produces in core: `ThroughputWeek`, `CFDPoint`, `AgingIssue`, `TallaMetric`, `ForecastResult` (+ `ForecastWhen`, `ForecastHowMany`, `ForecastBin`), `BottleneckResult` (+ `BottleneckState`, `BottleneckStateDetail`, `BottleneckTopIssue`, `BottleneckTallaBreakdown`, `BottleneckWeekPoint`, `BottleneckScore`), `WipRiskResult` (+ `WipRiskItem`, `TallaLimit`, `WipRiskLevel`), `ComparisonResult` (+ `ComparisonPeriod`).

- [ ] **Step 1:** Copy those interface/type definitions verbatim from `server/src/types.ts` into `shared/core/types.ts`.
- [ ] **Step 2:** In `server/src/types.ts`, remove those local definitions and add them to the existing `export type { ... } from '../../shared/core/types'` re-export block (keep `Issue`, `TeamMember`, and any server-only types local).
- [ ] **Step 3:** Typecheck: `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` → clean (client imports these from `server/src/types`, still resolved via re-export).
- [ ] **Step 4:** Commit: `refactor(core): move remaining result types to shared/core, re-export from server`

---

### Task 2: metrics.ts family → core (throughput, CFD, aging, by-talla)

**Files:** Create `shared/core/metricsExtra.ts` + `shared/core/metricsExtra.test.ts`; modify `server/src/services/metrics.ts`.

**Reference (port faithfully, swap SQL for in-memory):** `server/src/services/metrics.ts` — `getThroughputWeekly`, `getCFD`, `getAgingWIP`, `getCycleTimeByTalla`.

**Interfaces (produce in core):**
- `computeThroughputWeekly(issues, transitions, params, now?) → ThroughputWeek[]`
- `computeCFD(issues, transitions, params, now?) → CFDPoint[]`
- `computeAgingWIP(issues, params, now?) → AgingIssue[]`
- `computeCycleTimeByTalla(issues, transitions, params) → TallaMetric[]` (uses `computeCycleTimes` + `percentile` from core)

- [ ] **Step 1:** Write `shared/core/metricsExtra.test.ts` porting the relevant cases from `server/src/services/metrics.test.ts` (throughput weekly grouping incl. by_talla; CFD per-day buckets; aging days_in_status + sort; by-talla p50/count/team_p50) onto in-memory arrays, passing a fixed `now` where used.
- [ ] **Step 2:** Run → RED.
- [ ] **Step 3:** Implement `shared/core/metricsExtra.ts`. Port each function: keep the pure logic (weekStart JS, toBucket map, days_in_status arithmetic, MIN_DAYS filter) identical; replace SQL with in-memory: `computeCFD`/aging need "status at end of day" = last transition ≤ day else issue.status (same as scorecard `activeWipAt`); throughput = Done transitions in window grouped by ISO week (JS `weekStart`); aging excludes Done/Finalizada/Cancelled/Cancelado and computes `days_in_status` from `last_transition_at ?? created_at` vs `now`. Preserve exact status literals and string comparisons.
- [ ] **Step 4:** Run core test → GREEN.
- [ ] **Step 5:** In `server/src/services/metrics.ts`, make `getThroughputWeekly`/`getCFD`/`getAgingWIP`/`getCycleTimeByTalla` load rows (reuse `loadIssuesAndTransitions` from Task 4 of SP1) and delegate to the `compute*`. Pass `AGING_THRESHOLD_DAYS`-independent `now = new Date()` where needed.
- [ ] **Step 6:** `cd server && npx vitest run` → `metrics.test.ts` passes UNCHANGED; 0 failures.
- [ ] **Step 7:** Commit: `refactor: port throughput/CFD/aging/by-talla to core; server delegates`

---

### Task 3: comparison → core

**Files:** Create `shared/core/comparison.ts` + test; modify `server/src/services/comparison.ts`.

**Reference:** `server/src/services/comparison.ts` (`getComparison`, incl. `assignee` filter + `now`/`week` opts, `DONE_STATUSES`/`WIP_EXCLUDED`, ISO Monday windows).

**Interfaces:** `computeComparison(issues, transitions, opts: { week?, now?, assignee? }) → ComparisonResult`.

- [ ] **Step 1:** Write `shared/core/comparison.test.ts` porting `server/src/services/comparison.test.ts` cases (zero counts; throughput window; wip snapshot; deltaPct null; opts.week; assignee filter) to in-memory arrays. RED.
- [ ] **Step 2:** Implement `computeComparison` (port; in-memory throughput = Done-transition occurrences in week window filtered by assignee's issue; wip snapshot = active-at-instant per issue). GREEN.
- [ ] **Step 3:** `server/src/services/comparison.ts` loads rows + delegates; `getComparison(db, {week, assignee, now})` unchanged signature.
- [ ] **Step 4:** `cd server && npx vitest run` → `comparison.test.ts` unchanged & green.
- [ ] **Step 5:** Commit: `refactor: port comparison to core; server delegates`

---

### Task 4: wipRisk → core

**Files:** Create `shared/core/wipRisk.ts` + test; modify `server/src/services/wipRisk.ts`.

**Reference:** `server/src/services/wipRisk.ts` (`getWipRisk`, `now` opt, talla limits, age computation, risk levels).

**Interfaces:** `computeWipRisk(issues, transitions, opts: { now? }) → WipRiskResult` (loader provides whatever columns it needs — likely issues with talla/status/created_at/last_transition_at; read the source).

- [ ] **Step 1:** Write core test porting `wipRisk.test.ts` cases. RED.
- [ ] **Step 2:** Implement `computeWipRisk` (port; preserve age = now - start, limits per talla, level thresholds). GREEN.
- [ ] **Step 3:** Server delegates; `getWipRisk(db, {now})` unchanged.
- [ ] **Step 4:** `cd server && npx vitest run` → `wipRisk.test.ts` unchanged & green.
- [ ] **Step 5:** Commit: `refactor: port wipRisk to core; server delegates`

---

### Task 5: forecast → core (Monte Carlo, rng injected)

**Files:** Create `shared/core/forecast.ts` + test; modify `server/src/services/forecast.ts`.

**Reference:** `server/src/services/forecast.ts` (`getForecast`, `opts.rng ?? Math.random`, `now`, lookback/horizon/trials).

**Interfaces:** `computeForecast(issues, transitions, opts: { rng?, now?, ... }) → ForecastResult`. Keep `rng` injectable (default `Math.random`); the core does NOT call `Math.random` except via the `rng` param default.

- [ ] **Step 1:** Write core test porting `forecast.test.ts` (uses a fixed/seeded `rng` for determinism; insufficient-data case; percentile bins). RED.
- [ ] **Step 2:** Implement `computeForecast` (port the Monte Carlo loop verbatim, `rng` param). GREEN.
- [ ] **Step 3:** Server `getForecast(db, opts)` loads rows + delegates (passes through `opts.rng`/`now`).
- [ ] **Step 4:** `cd server && npx vitest run` → `forecast.test.ts` unchanged & green.
- [ ] **Step 5:** Commit: `refactor: port forecast (Monte Carlo) to core; server delegates`

---

### Task 6: bottleneck → core (largest)

**Files:** Create `shared/core/bottleneck.ts` + test; modify `server/src/services/bottleneck.ts`.

**Reference:** `server/src/services/bottleneck.ts` (`getBottleneck`, 233 lines — read it fully). Swap all SQL data-access for in-memory over `CoreIssue[]`/`CoreTransition[]`, preserving exact semantics (state queues, mean time in state, talla breakdown, weekly points, scores).

**Interfaces:** `computeBottleneck(issues, transitions, opts?) → BottleneckResult` (loader provides needed columns — read the source).

- [ ] **Step 1:** Write core test porting `bottleneck.test.ts` (all cases). RED.
- [ ] **Step 2:** Implement `computeBottleneck` (careful in-memory port; if any semantic is ambiguous, STOP and escalate rather than guess). GREEN.
- [ ] **Step 3:** Server `getBottleneck(...)` loads rows + delegates; unchanged signature.
- [ ] **Step 4:** `cd server && npx vitest run` → `bottleneck.test.ts` unchanged & green.
- [ ] **Step 5:** Commit: `refactor: port bottleneck to core; server delegates`

---

### Task 7: Final verification

- [ ] **Step 1:** `cd shared/core && npx vitest run` → all green.
- [ ] **Step 2:** `cd server && npx vitest run` → 0 failures (all service tests unchanged & green).
- [ ] **Step 3:** `cd shared/core && npx tsc --noEmit`; `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit` → clean.
- [ ] **Step 4:** Purity: `grep -rnE "better-sqlite3|process.env" shared/core/*.ts` → no matches.

---

## Self-Review

**Spec coverage:** all 8 functions (Tasks 2–6) + types moved (Task 1) + verification (Task 7). ✓
**Type consistency:** result types defined once in core (Task 1), consumed by `compute*` (Tasks 2–6) and re-exported for server/client. Each `computeX` signature matches its server caller.
**Placeholder scan:** compute bodies for the dense ports (CFD, forecast, bottleneck) reference the exact source files by path (faithful transcription, as done for scorecard in SP1) rather than inlining hundreds of lines — the source is the precise reference and the server tests are the parity gate. Simpler ports have concrete step guidance.
**Parity gate:** every ported function's existing server test must pass unchanged (Tasks 2–6 + 7).
**Out of scope:** writers/transports/direct-sync (SP4c-1/2/3), secure-store/Ajustes (SP4d), mode switch (SP5).
