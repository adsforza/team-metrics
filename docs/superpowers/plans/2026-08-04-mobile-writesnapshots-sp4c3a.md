# SP4c-3a: Shared writeSnapshots (mobile) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract `performSync`'s snapshot-writing transaction into a reusable `writeSnapshots(db, bundle, syncedAt)` (new `mobile/lib/snapshots.ts`), and refactor `performSync` to build a `SnapshotBundle` and call it — **no behavior change** (`mobile/__tests__/sync.test.ts` passes unchanged).

**Architecture:** `writeSnapshots` becomes the single writer of the 12 snapshot tables, shared by backend mode (performSync) and the future direct mode (SP4c-3b). The bundle carries optional per-metric values; `writeSnapshots` writes only what's present, in one transaction, identical to today.

**Tech Stack:** TypeScript, expo-sqlite, jest. Types from `@teammetrics/core/types` + mobile `./types` (Issue).

## Global Constraints

- **No behavior change**: `mobile/__tests__/sync.test.ts` passes UNCHANGED (mocks fetch + expo-sqlite; asserts success/errors/okCount/LAST_SYNCED_KEY). What gets written + the returned SyncResult stay identical.
- The comparison prune MUST use `bundle.comparisonWeeks` (the requested window, = `mondays` in performSync), not the fulfilled set — preserving that a failed-week isn't deleted.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: Extract `writeSnapshots` + refactor `performSync`

**Files:** Create `mobile/lib/snapshots.ts`, `mobile/__tests__/snapshots.test.ts`; modify `mobile/lib/sync.ts`.

**Reference (the exact code to move):** the `await db.withTransactionAsync(async () => { ... })` block currently inside `performSync` in `mobile/lib/sync.ts`. Read it fully.

**Interfaces:**
- Produces: `SnapshotBundle` + `writeSnapshots(db, bundle, syncedAt) → Promise<void>` in `mobile/lib/snapshots.ts`.
- `performSync` keeps its signature + `SyncResult` return.

- [ ] **Step 1: Create `mobile/lib/snapshots.ts`** with `SnapshotBundle` (all fields optional, per the spec) and `writeSnapshots(db, bundle, syncedAt)`:
  - Move the transaction body VERBATIM from `performSync`.
  - Replace each `<x>.status === 'fulfilled'` guard with `bundle.<x> !== undefined`, and each `<x>.value` with `bundle.<x>`.
  - For comparisons: `DELETE FROM comparison_snapshot WHERE week NOT IN (bundle.comparisonWeeks ...)` then insert each of `bundle.comparisons` (`{week, result}`). If `comparisonWeeks` is undefined, skip the prune.
  - Import types from `@teammetrics/core/types` and mobile `./types` (`Issue`), and `SQLite` from `expo-sqlite`.

- [ ] **Step 2: Refactor `performSync`** in `mobile/lib/sync.ts`:
  - After the `allSettled` results, build the bundle:
    ```ts
    const bundle: SnapshotBundle = {
      kpi: kpi.status === 'fulfilled' ? kpi.value : undefined,
      throughput: throughput.status === 'fulfilled' ? throughput.value : undefined,
      team: team.status === 'fulfilled' ? team.value : undefined,
      aging: aging.status === 'fulfilled' ? aging.value : undefined,
      wipRisk: wipRisk.status === 'fulfilled' ? wipRisk.value : undefined,
      bottleneck: bottleneck.status === 'fulfilled' ? bottleneck.value : undefined,
      forecast: forecast.status === 'fulfilled' ? forecast.value : undefined,
      cfd: cfd.status === 'fulfilled' ? cfd.value : undefined,
      issues: issues.status === 'fulfilled' ? issues.value : undefined,
      byTalla: byTalla.status === 'fulfilled' ? byTalla.value : undefined,
      comparisonWeeks: mondays,
      comparisons: comparisons.flatMap((c, i) => c.status === 'fulfilled' ? [{ week: c.value.week, result: c.value }] : []),
    };
    await writeSnapshots(db, bundle, syncedAt);
    ```
  - Keep the existing `errors.push(...)` for each rejected result (move them next to the bundle build or keep before). Keep okCount/failCount, `LAST_SYNCED_KEY` guard, config fetch, and the returned `SyncResult` EXACTLY as they are.
  - Remove the now-extracted transaction body.

- [ ] **Step 3: Write `mobile/__tests__/snapshots.test.ts`** (db stub recording runAsync):
  - `writeSnapshots` with a partial bundle (e.g. only `kpi` + `throughput`) issues writes only for those tables (no scorecard/aging/etc writes).
  - With `comparisonWeeks: ['w1','w2']` + `comparisons: [{week:'w1', result}]` → issues a `DELETE ... WHERE week NOT IN (?,?)` with `['w1','w2']` and one comparison insert for `w1`.

- [ ] **Step 4: Run tests**

Run: `cd mobile && npx jest __tests__/snapshots.test.ts` → PASS.
Run: `cd mobile && npx jest __tests__/sync.test.ts` → PASS UNCHANGED (do NOT edit sync.test.ts).

- [ ] **Step 5: Typecheck**

Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/snapshots.ts mobile/lib/sync.ts mobile/__tests__/snapshots.test.ts
git commit -m "refactor(mobile): extract writeSnapshots; performSync builds a SnapshotBundle"
```

---

### Task 2: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures (sync.test unchanged & green + new snapshots.test).
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
- [ ] **Step 3 (optional):** `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c3a-export` → bundles OK.

---

## Self-Review

**Spec coverage:** `SnapshotBundle` + `writeSnapshots` extracted (Task 1 Step 1); performSync builds bundle + delegates (Step 2); comparison prune uses `comparisonWeeks` (parity) (Step 1); tests (Step 3); sync.test unchanged gate (Step 4). ✓
**Type consistency:** bundle fields typed with the core result types (SP4c-0) + mobile `Issue`; `writeSnapshots` consumed by performSync (Task 1) and later directSync (SP4c-3b).
**Placeholder scan:** transaction body is a verbatim move from the existing file (cited) — not re-invented.
**Out of scope:** directSync orchestration (SP4c-3b), secure-store/Ajustes (SP4d), mode switch (SP5).
