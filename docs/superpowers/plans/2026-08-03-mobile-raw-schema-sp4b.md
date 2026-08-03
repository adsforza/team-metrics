# SP4b: Mobile raw schema + core loaders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add raw `issues`/`transitions`/`team_members` tables to the mobile SQLite (mirror of the server) and loaders that return `CoreIssue[]`/`CoreTransition[]`/`CoreMember[]`, so the core's `compute*` functions can run on-device. Additive — no existing table or reader changes.

**Architecture:** Direct mode will persist raw Jira data on-device and compute the same snapshots locally (screens unchanged). SP4b is the storage substrate + loaders; writers/sync/compute are SP4c.

**Tech Stack:** TypeScript, expo-sqlite, jest (`jest-expo`). Imports `@teammetrics/core/types` (resolved via the `file:../shared/core` dep + Metro config from SP4a).

## Global Constraints

- Additive only: do NOT modify existing tables (`issues_snapshot`, `scorecard_members`, etc.) or existing readers.
- Loaders return the exact `CoreIssue`/`CoreTransition`/`CoreMember` shapes from `@teammetrics/core/types`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` (the `.bin/tsc` shim is broken).

---

### Task 1: Raw tables + core loaders (TDD)

**Files:**
- Modify: `mobile/lib/db.ts` (add 3 tables to `initSchema`; add `loadCoreIssues`/`loadCoreTransitions`/`loadCoreMembers`)
- Create: `mobile/__tests__/coreLoad.test.ts`

**Interfaces:**
- Consumes: `CoreIssue`, `CoreTransition`, `CoreMember` from `@teammetrics/core/types`; `SQLite.SQLiteDatabase`.
- Produces: `loadCoreIssues(db) → Promise<CoreIssue[]>`, `loadCoreTransitions(db) → Promise<CoreTransition[]>`, `loadCoreMembers(db) → Promise<CoreMember[]>`.

- [ ] **Step 1: Write the failing test** `mobile/__tests__/coreLoad.test.ts`

The loaders take `db` as a parameter, so the test passes a stub `db` with a recording `getAllAsync` — no module mock needed.

```ts
import { loadCoreIssues, loadCoreTransitions, loadCoreMembers } from '../lib/db';

function stubDb(rowsBySql: (sql: string) => any[]) {
  const calls: string[] = [];
  const db: any = { getAllAsync: async (sql: string) => { calls.push(sql); return rowsBySql(sql); } };
  return { db, calls };
}

describe('core loaders', () => {
  it('loadCoreIssues selects the CoreIssue columns and returns typed rows', async () => {
    const rows = [{ id: 'A', status: 'In Progress', assignee_id: 'u1', talla: 'M', created_at: 'c', last_transition_at: 'l' }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreIssues(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM issues');
    expect(calls[0]).toMatch(/id, status, assignee_id, talla, created_at, last_transition_at/);
  });

  it('loadCoreTransitions selects transition columns', async () => {
    const rows = [{ issue_id: 'A', from_status: 'To Do', to_status: 'In Progress', transitioned_at: 't' }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreTransitions(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM transitions');
  });

  it('loadCoreMembers selects member columns ordered by display_name', async () => {
    const rows = [{ id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreMembers(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM team_members');
    expect(calls[0]).toContain('ORDER BY display_name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/coreLoad.test.ts`
Expected: FAIL ("loadCoreIssues is not a function").

- [ ] **Step 3: Add the raw tables to `initSchema`** in `mobile/lib/db.ts`

Inside the `db.execAsync(\`...\`)` template in `initSchema`, append these three tables (keep all existing tables):

```sql
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
      assignee_id TEXT, talla TEXT, talla_confidence REAL,
      created_at TEXT, updated_at TEXT, last_transition_at TEXT
    );
    CREATE TABLE IF NOT EXISTS transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT,
      from_status TEXT, to_status TEXT, transitioned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY, display_name TEXT, email TEXT, avatar_url TEXT
    );
```

- [ ] **Step 4: Add the loaders** in `mobile/lib/db.ts`

Add the import at the top (with the other type imports):

```ts
import type { CoreIssue, CoreTransition, CoreMember } from '@teammetrics/core/types';
```

Add the loaders in the readers section:

```ts
export function loadCoreIssues(db: SQLite.SQLiteDatabase): Promise<CoreIssue[]> {
  return db.getAllAsync<CoreIssue>(
    'SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues'
  );
}

export function loadCoreTransitions(db: SQLite.SQLiteDatabase): Promise<CoreTransition[]> {
  return db.getAllAsync<CoreTransition>(
    'SELECT issue_id, from_status, to_status, transitioned_at FROM transitions'
  );
}

export function loadCoreMembers(db: SQLite.SQLiteDatabase): Promise<CoreMember[]> {
  return db.getAllAsync<CoreMember>(
    'SELECT id, display_name, email, avatar_url FROM team_members ORDER BY display_name'
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/coreLoad.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/coreLoad.test.ts
git commit -m "feat(mobile): raw issues/transitions/team_members tables + core loaders"
```

---

### Task 2: Final verification

- [ ] **Step 1: Full mobile suite**

Run: `cd mobile && npm test`
Expected: 0 failures (existing suites + the 3 new loader tests). Existing tests unaffected (additive change).

- [ ] **Step 2: Typecheck**

Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`
Expected: no new errors (the pre-existing `TabHeader.tsx` `@react-navigation/bottom-tabs` error is unrelated and may remain). Confirm `@teammetrics/core/types` resolves (via the `file:` symlink).

- [ ] **Step 3: Bundle sanity (optional but recommended)**

Run: `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4b-export`
Expected: `iOS Bundled ... ` success — confirms `db.ts` importing `@teammetrics/core/types` still bundles.

---

## Self-Review

**Spec coverage:**
- Raw `issues`/`transitions`/`team_members` tables (mirror server) → Task 1 Step 3. ✓
- `loadCoreIssues`/`loadCoreTransitions`/`loadCoreMembers` returning Core types → Task 1 Step 4. ✓
- Additive (existing tables/readers untouched) → Global Constraints + Task 2 Step 1. ✓
- Tests via stub db → Task 1 Step 1. ✓
- `@teammetrics/core/types` resolves → Task 2 Step 2/3. ✓

**Type consistency:** loaders return `CoreIssue[]`/`CoreTransition[]`/`CoreMember[]` exactly as defined in `shared/core/types.ts` (SP1). Column lists match those shapes.

**Placeholder scan:** none — all code inline.

**Out of scope (SP4b):** writers, `board_sync`, direct-sync/compute (SP4c); secure-store + Ajustes UI (SP4d); mode switch (SP5).
