# SP4c-3b: Direct-sync orchestration (mobile) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the direct mode end-to-end: `computeBundle` (pure, all core computes → `SnapshotBundle`), the small talla writer/reader, and `directSync(db, config, deps?)` that fetches Jira → upserts raw → classifies → computes → `writeSnapshots`. `directSync` is built + tested but NOT yet called from the UI (that's SP5).

**Architecture:** Assembles existing pieces — core computes (SP1/SP4c-0), transports (SP4c-2), raw writers/loaders (SP4b/SP4c-1), `writeSnapshots` (SP4c-3a). The compute→bundle mapping is isolated as a pure `computeBundle` for testability; `directSync` is a thin orchestrator with injectable deps.

**Tech Stack:** TypeScript, expo-sqlite, jest. Core from `@teammetrics/core/*`; mobile `Issue`/`SnapshotBundle`.

## Global Constraints

- Additive: new `mobile/lib/directSync.ts` + small additions to `db.ts`; do NOT change existing behavior. `directSync` is not wired into the app yet.
- `computeBundle` is pure (no DB, no network, `now` param) → fully unit-tested.
- Best-effort classification: if Gemini errors/quota, continue; metrics compute with talla null.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: `computeBundle` (pure) + talla writer/reader (TDD)

**Files:** Create `mobile/lib/directSync.ts` (add `computeBundle`) + `mobile/__tests__/computeBundle.test.ts`; modify `mobile/lib/db.ts` (add `updateIssueTallas`, `readUnclassifiedIssues`).

**Reference:** the core compute signatures in `shared/core/metrics.ts`, `metricsExtra.ts`, `scorecard.ts`, `comparison.ts`, `wipRisk.ts`, `forecast.ts`, `bottleneck.ts`; the `SnapshotBundle` in `mobile/lib/snapshots.ts`; the `Issue` shape + `readIssues`/`issues_snapshot` columns in `mobile/lib/db.ts` (for the raw→Issue mapping); `getLastNMondays` in `mobile/lib/weeks.ts`.

**Interfaces:**
- `computeBundle(issues: CoreIssue[], transitions: CoreTransition[], members: CoreMember[], filters: { from?: string; to?: string; assignee?: string | null }, now?: Date) → SnapshotBundle`
- `updateIssueTallas(db, results: Map<string, { talla: string | null; confidence: number }>) → Promise<void>`
- `readUnclassifiedIssues(db) → Promise<{ id: string; title: string; description: string }[]>`

- [ ] **Step 1: Write `mobile/__tests__/computeBundle.test.ts`** — with a small in-memory set of issues/transitions/members, assert the bundle has all fields populated with correct shapes: `kpi.wip` a number, `throughput` an array, `team.members` present, `comparisons.length === 6` and `comparisonWeeks.length === 6`, `aging`/`wipRisk`/`bottleneck`/`forecast`/`cfd`/`byTalla` present, `issues` mapped (id/title/status). RED first.

- [ ] **Step 2: Implement `computeBundle`** in `mobile/lib/directSync.ts`:
  - `const params = { from: filters.from, to: filters.to, assignee: filters.assignee ?? undefined };`
  - Call each core compute with `params`/`now` (matching what the server endpoints return):
    `computeKpis(issues, transitions, params, 7, now)`, `computeThroughputWeekly(...)`, `computeScorecard(issues, transitions, members, params, now)`, `computeAgingWIP(issues, params, now)`, `computeWipRisk(issues, transitions, { now })`, `computeBottleneck(issues, transitions)`, `computeForecast(issues, transitions, { now })`, `computeCFD(issues, transitions, params, now)`, `computeCycleTimeByTalla(issues, transitions, params)`.
    (Read each core signature; pass exactly what it expects.)
  - `const weeks = getLastNMondays(6); const comparisons = weeks.map(w => ({ week: w, result: computeComparison(issues, transitions, { week: w, now, assignee: filters.assignee }) }));`
  - `issues` bundle field: map the raw `issues` to the mobile `Issue` shape used by `issues_snapshot`/`readIssues` (id→id, title, status, talla, assignee_id, created_at, last_transition_at; `ct_days` computed per issue like the server's `/api/issues`, or null — read the server `routes/issues.ts` / `getCycleTimes` to match; null is acceptable if the exact server formula is unclear, note it).
  - Return the `SnapshotBundle` with `comparisonWeeks: weeks`.

- [ ] **Step 3: Add `updateIssueTallas` + `readUnclassifiedIssues`** to `mobile/lib/db.ts`:
```ts
export async function readUnclassifiedIssues(db: SQLite.SQLiteDatabase): Promise<{ id: string; title: string; description: string }[]> {
  return db.getAllAsync(`SELECT id, title, description FROM issues WHERE talla IS NULL`);
}
export async function updateIssueTallas(db: SQLite.SQLiteDatabase, results: Map<string, { talla: string | null; confidence: number }>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [id, r] of results) {
      if (r.talla) await db.runAsync(`UPDATE issues SET talla=?, talla_confidence=? WHERE id=?`, [r.talla, r.confidence, id]);
    }
  });
}
```

- [ ] **Step 4:** Run `cd mobile && npx jest __tests__/computeBundle.test.ts` → GREEN. Add a small db-stub test for `updateIssueTallas`/`readUnclassifiedIssues` (SQL correct) in the same or a sibling test file.

- [ ] **Step 5: Commit**
```bash
git add mobile/lib/directSync.ts mobile/lib/db.ts mobile/__tests__/computeBundle.test.ts
git commit -m "feat(mobile): computeBundle (core→SnapshotBundle) + talla writer/reader"
```

---

### Task 2: `directSync` orchestrator (TDD)

**Files:** Modify `mobile/lib/directSync.ts` (add `directSync`); create `mobile/__tests__/directSync.test.ts`.

**Interfaces:**
- `directSync(db, config: { boards: JiraConfig[]; geminiKey: string; filters: {from?;to?;assignee?} }, deps?: { http?: JiraHttp; makeGen?: (key: string) => GenerateFn; now?: Date }) → Promise<{ success: boolean; errors: {endpoint:string;message:string}[]; syncedAt: string; okCount: number; failCount: number }>`
- Consumes: `fetchBoardIssues` (core), `jiraHttpFetch`/`makeGeminiGenerate` (transports, as `deps` defaults), `upsertRawIssues`/`getBoardLastSync`/`setBoardLastSync`/`readUnclassifiedIssues`/`updateIssueTallas`/`loadCore*` (db), `classifyTallaBatch` (core), `computeBundle` (Task 1), `writeSnapshots` (SP4c-3a).

- [ ] **Step 1: Write `mobile/__tests__/directSync.test.ts`** — inject `deps.http` (returns canned `JiraIssueRaw[]`), `deps.makeGen` (returns a fake `GenerateFn` yielding a talla JSON), `deps.now`; use a `db` stub that records upserts and returns seeded rows from `loadCore*`/`readUnclassifiedIssues` and captures the `writeSnapshots` call (or spy). Assert: it fetched per board with `since` from `getBoardLastSync`, upserted raw, classified the unclassified, computed a bundle, and called `writeSnapshots`; returns `success:true`. RED first.

- [ ] **Step 2: Implement `directSync`** per the spec flow (fetch per board → upsertRawIssues → setBoardLastSync; classify unclassified in batches of 20 best-effort → updateIssueTallas; loadCore*; computeBundle; writeSnapshots; accumulate errors; return SyncResult-like). `deps.http ?? jiraHttpFetch`, `deps.makeGen ?? makeGeminiGenerate`, `deps.now ?? new Date()`.

- [ ] **Step 3:** Run `cd mobile && npx jest __tests__/directSync.test.ts` → GREEN.

- [ ] **Step 4: Commit**
```bash
git add mobile/lib/directSync.ts mobile/__tests__/directSync.test.ts
git commit -m "feat(mobile): directSync orchestrator (fetch→upsert→classify→compute→snapshots)"
```

---

### Task 3: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures (existing + new).
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
- [ ] **Step 3:** `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c3b-export` → `iOS Bundled` OK.

---

## Self-Review

**Spec coverage:** `computeBundle` pure (Task 1) + `updateIssueTallas`/`readUnclassifiedIssues` (Task 1) + `directSync` orchestrator with injectable deps (Task 2) + verification (Task 3). Best-effort classification, filters passthrough, config-as-param all reflected. ✓
**Type consistency:** `computeBundle → SnapshotBundle` (SP4c-3a); `directSync` consumes core `fetchBoardIssues`/`classifyTallaBatch`, transports (SP4c-2), writers/loaders (SP4b/c-1), `writeSnapshots` (SP4c-3a) — all existing signatures.
**Placeholder scan:** compute calls reference core signatures by file (implementer reads them); Issue `ct_days` mapping references server `routes/issues.ts` with null fallback noted. No invented APIs.
**Out of scope:** secure-store + Ajustes (SP4d); wiring directSync into syncStore + reachability mode switch (SP5).
