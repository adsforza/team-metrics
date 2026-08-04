# SP4c-1: Mobile raw writers + board_sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `upsertRawIssues` (persist `JiraIssueRaw[]` into the raw tables, mirroring the server's `upsertBatch`, preserving `talla`) and `board_sync` helpers to `mobile/lib/db.ts`.

**Architecture:** Direct mode (SP4c-3) will fetch Jira → `upsertRawIssues` → classify → compute → snapshots. This task is the write side. Adapts the server `upsertBatch` (`server/src/services/sync.ts`) to expo-sqlite's async API.

**Tech Stack:** TypeScript, expo-sqlite, jest. Imports `JiraIssueRaw` from `@teammetrics/core/jira`.

## Global Constraints

- Additive: new `board_sync` table + new functions; do NOT modify existing tables/readers/writers.
- The `issues` upsert MUST NOT overwrite `talla`/`talla_confidence` (new issues get NULL; classification is separate — same decoupling the server uses).
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: `upsertRawIssues` + `board_sync` (TDD)

**Files:** Modify `mobile/lib/db.ts`; create `mobile/__tests__/rawWriters.test.ts`.

**Interfaces:**
- Consumes: `JiraIssueRaw` from `@teammetrics/core/jira`; `SQLite.SQLiteDatabase`.
- Produces: `upsertRawIssues(db, issues) → Promise<void>`, `getBoardLastSync(db, boardId) → Promise<string|undefined>`, `setBoardLastSync(db, boardId, iso) → Promise<void>`.

- [ ] **Step 1: Write the failing test** `mobile/__tests__/rawWriters.test.ts`

```ts
import { upsertRawIssues, getBoardLastSync, setBoardLastSync } from '../lib/db';
import type { JiraIssueRaw } from '@teammetrics/core/jira';

function stubDb() {
  const runs: { sql: string; args: any[] }[] = [];
  const db: any = {
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
    runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
    getFirstAsync: async (_sql: string, _args: any[] = []) => null, // nothing exists yet
  };
  return { db, runs };
}

const issue = (over: Partial<JiraIssueRaw> = {}): JiraIssueRaw => ({
  id: 'OPS-1', title: 'T', description: 'D', status: 'In Progress',
  assignee: { id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null },
  created_at: 'c', updated_at: 'u',
  transitions: [
    { from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T00:00:00Z' },
    { from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-01-05T00:00:00Z' },
  ],
  ...over,
});

describe('upsertRawIssues', () => {
  it('upserts team member, issue (last_transition_at = max), and transitions; issue upsert never touches talla', async () => {
    const { db, runs } = stubDb();
    await upsertRawIssues(db, [issue()]);
    const memberSql = runs.find(r => r.sql.includes('team_members'));
    expect(memberSql).toBeTruthy();
    const issueSql = runs.find(r => r.sql.includes('INTO issues'));
    expect(issueSql).toBeTruthy();
    expect(issueSql!.sql).not.toMatch(/talla/);              // does NOT insert or update talla
    expect(issueSql!.args).toContain('2026-01-05T00:00:00Z'); // last_transition_at = max
    const tRuns = runs.filter(r => r.sql.includes('INTO transitions'));
    expect(tRuns).toHaveLength(2);
  });

  it('does not re-insert an existing transition (dedup via getFirstAsync)', async () => {
    const runs: { sql: string; args: any[] }[] = [];
    const db: any = {
      withTransactionAsync: async (fn: any) => { await fn(); },
      runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
      getFirstAsync: async () => ({ id: 1 }), // pretend every transition already exists
    };
    await upsertRawIssues(db, [issue()]);
    expect(runs.filter(r => r.sql.includes('INTO transitions'))).toHaveLength(0);
  });

  it('skips team_members upsert when assignee is null', async () => {
    const { db, runs } = stubDb();
    await upsertRawIssues(db, [issue({ assignee: null })]);
    expect(runs.find(r => r.sql.includes('team_members'))).toBeUndefined();
  });
});

describe('board_sync', () => {
  it('get returns stored value; set upserts', async () => {
    const runs: { sql: string; args: any[] }[] = [];
    const db: any = {
      runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
      getFirstAsync: async () => ({ last_synced_at: '2026-01-01T00:00:00Z' }),
    };
    expect(await getBoardLastSync(db, 7)).toBe('2026-01-01T00:00:00Z');
    await setBoardLastSync(db, 7, '2026-02-02T00:00:00Z');
    const setSql = runs.find(r => r.sql.includes('board_sync'));
    expect(setSql!.args).toEqual([7, '2026-02-02T00:00:00Z']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/rawWriters.test.ts`
Expected: FAIL ("upsertRawIssues is not a function").

- [ ] **Step 3: Add the `board_sync` table** to `initSchema` in `mobile/lib/db.ts`:

```sql
    CREATE TABLE IF NOT EXISTS board_sync (
      board_id INTEGER PRIMARY KEY, last_synced_at TEXT
    );
```

- [ ] **Step 4: Add the writers** in `mobile/lib/db.ts` (import `JiraIssueRaw` at top: `import type { JiraIssueRaw } from '@teammetrics/core/jira';`):

```ts
export async function upsertRawIssues(db: SQLite.SQLiteDatabase, issues: JiraIssueRaw[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const issue of issues) {
      if (issue.assignee) {
        await db.runAsync(
          `INSERT INTO team_members (id, display_name, email, avatar_url) VALUES (?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url`,
          [issue.assignee.id, issue.assignee.display_name, issue.assignee.email, issue.assignee.avatar_url]
        );
      }
      const lastTransition = issue.transitions.length
        ? issue.transitions.reduce((a, b) => (a.transitioned_at > b.transitioned_at ? a : b)).transitioned_at
        : null;
      // Note: talla/talla_confidence intentionally omitted — new issues default NULL and the
      // ON CONFLICT SET does not touch them (classification is a separate step).
      await db.runAsync(
        `INSERT INTO issues (id, title, description, status, assignee_id, created_at, updated_at, last_transition_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description, status=excluded.status,
           assignee_id=excluded.assignee_id, updated_at=excluded.updated_at, last_transition_at=excluded.last_transition_at`,
        [issue.id, issue.title, issue.description, issue.status, issue.assignee?.id ?? null, issue.created_at, issue.updated_at, lastTransition]
      );
      for (const t of issue.transitions) {
        const exists = await db.getFirstAsync(
          `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`,
          [issue.id, t.to_status, t.transitioned_at]
        );
        if (!exists) {
          await db.runAsync(
            `INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`,
            [issue.id, t.from_status, t.to_status, t.transitioned_at]
          );
        }
      }
    }
  });
}

export async function getBoardLastSync(db: SQLite.SQLiteDatabase, boardId: number): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ last_synced_at: string }>(
    'SELECT last_synced_at FROM board_sync WHERE board_id = ?', [boardId]
  );
  return row?.last_synced_at;
}

export async function setBoardLastSync(db: SQLite.SQLiteDatabase, boardId: number, iso: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO board_sync (board_id, last_synced_at) VALUES (?,?)
     ON CONFLICT(board_id) DO UPDATE SET last_synced_at=excluded.last_synced_at`,
    [boardId, iso]
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/rawWriters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/rawWriters.test.ts
git commit -m "feat(mobile): upsertRawIssues + board_sync (raw writers, talla-preserving)"
```

---

### Task 2: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures (existing suites + 4 new).
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors (pre-existing `TabHeader.tsx` error unrelated).
- [ ] **Step 3 (optional):** `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c1-export` → bundles OK.

---

## Self-Review

**Spec coverage:** `upsertRawIssues` mirroring server upsertBatch (team_member + issue talla-preserving + transition dedup) → Task 1 Step 4; `board_sync` table + get/set → Task 1 Steps 3-4; tests → Task 1 Step 1. ✓
**Type consistency:** `JiraIssueRaw` from `@teammetrics/core/jira` (SP2), matches the writer's input.
**Placeholder scan:** none — code inline.
**Out of scope:** transports (SP4c-2), direct-sync orchestration (SP4c-3), secure-store/Ajustes (SP4d), mode switch (SP5).
