# SP2: Portable Jira Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Jira response parsing (issues + changelog → transitions), JQL building, and the pagination loop into `shared/core/jira.ts` (pure, portable), with an **injected HTTP transport**. Refactor the server to delegate via an axios transport, with **no behavior change**.

**Architecture:** `shared/core/jira.ts` holds `parseJiraIssue`, `buildJql`, and `fetchBoardIssues(cfg, http, updatedSince?)` where `http: JiraHttp` is injected. The server provides `axiosHttp` (preserving its error mapping) and keeps `JiraClient` + `createJiraClients` (env) as thin wrappers. Mobile injects a `fetch` transport in SP4 (goes direct to Jira).

**Tech Stack:** TypeScript, vitest. Core has no `axios`, no Node built-ins, no `process.env`.

## Global Constraints

- `shared/core/jira.ts` MUST NOT import `axios`, Node built-ins, or read `process.env`.
- **No behavior change**: `server/src/services/jira.test.ts` passes UNCHANGED (it mocks `axios` and asserts `axios.get(url, {auth, params})` is called with the board URL + jql).
- Preserve the exact JQL string, pagination logic, field list, and error-message format (`Jira API error (status): msg`); the error mapping lives in the server's `axiosHttp`, not the core.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Run core tests: `cd shared/core && npx vitest run`. Server: `cd server && npx vitest run`.

---

### Task 1: Core `parseJiraIssue` + `buildJql` + types (TDD)

**Files:**
- Create: `shared/core/jira.ts`, `shared/core/jira.test.ts`

**Interfaces:**
- Produces: `JiraConfig`, `JiraIssueRaw`, `JiraHttpRequest`, `JiraHttp` types; `parseJiraIssue(raw) → JiraIssueRaw`; `buildJql(projectKey, updatedSince?) → string`.

- [ ] **Step 1: Write the failing test** `shared/core/jira.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseJiraIssue, buildJql } from './jira';

describe('parseJiraIssue', () => {
  const raw = {
    key: 'OPS-1',
    fields: {
      summary: 'Test issue',
      description: { content: [{ content: [{ text: 'hello' }, { text: 'world' }] }, { content: [{ text: 'again' }] }] },
      status: { name: 'In Progress' },
      assignee: { accountId: 'u1', displayName: 'User One', emailAddress: 'u@t.com', avatarUrls: { '48x48': 'http://img' } },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
    },
    changelog: { histories: [
      { created: '2026-01-02T10:00:00.000Z', items: [
        { field: 'status', fromString: 'To Do', toString: 'In Progress' },
        { field: 'assignee', fromString: null, toString: 'u1' }, // ignored (not status)
      ] },
    ] },
  };

  it('flattens ADF description, maps fields, derives status transitions, maps assignee', () => {
    const r = parseJiraIssue(raw);
    expect(r.id).toBe('OPS-1');
    expect(r.title).toBe('Test issue');
    expect(r.description).toBe('hello world again');
    expect(r.status).toBe('In Progress');
    expect(r.assignee).toEqual({ id: 'u1', display_name: 'User One', email: 'u@t.com', avatar_url: 'http://img' });
    expect(r.transitions).toEqual([{ from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T10:00:00.000Z' }]);
  });

  it('handles null assignee and empty/absent description & changelog', () => {
    const r = parseJiraIssue({ key: 'OPS-2', fields: { summary: 'x', description: null, status: { name: 'To Do' }, assignee: null, created: 'c', updated: 'u' } });
    expect(r.assignee).toBeNull();
    expect(r.description).toBe('');
    expect(r.transitions).toEqual([]);
  });
});

describe('buildJql', () => {
  it('project only when no updatedSince', () => {
    expect(buildJql('OPS')).toBe('project = OPS');
  });
  it('adds updated filter trimmed to 16 chars with space', () => {
    expect(buildJql('OPS', '2026-01-01T00:00:00.000Z')).toBe('project = OPS AND updated >= "2026-01-01 00:00"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run jira.test.ts`
Expected: FAIL ("parseJiraIssue is not a function").

- [ ] **Step 3: Implement `shared/core/jira.ts`** (port of `mapIssue` + JQL, verbatim logic)

```ts
export interface JiraConfig { baseUrl: string; email: string; apiToken: string; projectKey: string; boardId: number; }

export interface JiraIssueRaw {
  id: string; title: string; description: string; status: string;
  assignee: { id: string; display_name: string; email: string; avatar_url: string | null } | null;
  created_at: string; updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

export interface JiraHttpRequest { url: string; auth: { username: string; password: string }; params: Record<string, any>; }
export type JiraHttp = (req: JiraHttpRequest) => Promise<{ issues?: any[]; total?: number } & Record<string, any>>;

export function parseJiraIssue(raw: any): JiraIssueRaw {
  const desc = raw.fields.description;
  const descText = desc?.content
    ?.flatMap((b: any) => b.content?.map((t: any) => t.text) ?? [])
    .join(' ') ?? '';

  const transitions = (raw.changelog?.histories ?? []).flatMap((h: any) =>
    h.items
      .filter((item: any) => item.field === 'status')
      .map((item: any) => ({ from_status: item.fromString, to_status: item.toString, transitioned_at: h.created }))
  );

  const assignee = raw.fields.assignee ? {
    id: raw.fields.assignee.accountId,
    display_name: raw.fields.assignee.displayName,
    email: raw.fields.assignee.emailAddress,
    avatar_url: raw.fields.assignee.avatarUrls?.['48x48'] ?? null,
  } : null;

  return {
    id: raw.key,
    title: raw.fields.summary,
    description: descText,
    status: raw.fields.status.name,
    assignee,
    created_at: raw.fields.created,
    updated_at: raw.fields.updated,
    transitions,
  };
}

export function buildJql(projectKey: string, updatedSince?: string): string {
  return [
    `project = ${projectKey}`,
    updatedSince ? `updated >= "${updatedSince.replace('T', ' ').substring(0, 16)}"` : null,
  ].filter(Boolean).join(' AND ');
}
```

Note: `avatar_url` is typed `string | null` (the port `?? null` can yield null; the old server interface said `string` but was fed `any`). This is a type refinement, not a behavior change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run jira.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/core/jira.ts shared/core/jira.test.ts
git commit -m "feat(core): parseJiraIssue + buildJql + Jira types (pure)"
```

---

### Task 2: Core `fetchBoardIssues` with injected transport (TDD)

**Files:**
- Modify: `shared/core/jira.ts` (add `fetchBoardIssues`)
- Modify: `shared/core/jira.test.ts` (add tests with a fake transport)

**Interfaces:**
- Consumes: `parseJiraIssue`, `buildJql`, `JiraConfig`, `JiraHttp`.
- Produces: `fetchBoardIssues(cfg: JiraConfig, http: JiraHttp, updatedSince?) → Promise<JiraIssueRaw[]>`.

- [ ] **Step 1: Write the failing test** (append to `shared/core/jira.test.ts`)

```ts
import { fetchBoardIssues } from './jira';
import type { JiraHttp } from './jira';

const cfg = { baseUrl: 'https://t.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 7 };
const mkIssue = (k: string) => ({ key: k, fields: { summary: k, description: null, status: { name: 'To Do' }, assignee: null, created: 'c', updated: 'u' } });

describe('fetchBoardIssues', () => {
  it('paginates across pages and maps results; passes url/auth/params to transport', async () => {
    const calls: any[] = [];
    const http: JiraHttp = async (req) => {
      calls.push(req);
      if (req.params.startAt === 0) return { issues: [mkIssue('OPS-1'), mkIssue('OPS-2')], total: 3 };
      return { issues: [mkIssue('OPS-3')], total: 3 };
    };
    const res = await fetchBoardIssues(cfg, http, undefined);
    expect(res.map(r => r.id)).toEqual(['OPS-1', 'OPS-2', 'OPS-3']);
    expect(calls[0].url).toBe('https://t.atlassian.net/rest/agile/1.0/board/7/issue');
    expect(calls[0].auth).toEqual({ username: 'e@t.com', password: 'tok' });
    expect(calls[0].params).toMatchObject({ jql: 'project = OPS', startAt: 0, maxResults: 50, expand: 'changelog' });
    expect(calls[1].params.startAt).toBe(50);
  });

  it('stops on empty page and forwards updatedSince into jql', async () => {
    const http: JiraHttp = async () => ({ issues: [], total: 0 });
    const spy: any[] = [];
    const wrapped: JiraHttp = async (req) => { spy.push(req); return http(req); };
    const res = await fetchBoardIssues(cfg, wrapped, '2026-01-01T00:00:00.000Z');
    expect(res).toEqual([]);
    expect(spy[0].params.jql).toContain('updated >=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run jira.test.ts`
Expected: FAIL ("fetchBoardIssues is not a function").

- [ ] **Step 3: Implement `fetchBoardIssues`** (append to `shared/core/jira.ts`)

```ts
export async function fetchBoardIssues(cfg: JiraConfig, http: JiraHttp, updatedSince?: string): Promise<JiraIssueRaw[]> {
  const results: JiraIssueRaw[] = [];
  let startAt = 0;
  const maxResults = 50;
  const jql = buildJql(cfg.projectKey, updatedSince);
  const url = `${cfg.baseUrl}/rest/agile/1.0/board/${cfg.boardId}/issue`;
  const auth = { username: cfg.email, password: cfg.apiToken };

  while (true) {
    const data = await http({
      url, auth,
      params: { jql, startAt, maxResults, expand: 'changelog', fields: 'summary,description,status,assignee,created,updated' },
    });
    const issues: any[] = Array.isArray(data.issues) ? data.issues : [];
    const total: number = typeof data.total === 'number' ? data.total : 0;
    for (const issue of issues) results.push(parseJiraIssue(issue));
    if (issues.length === 0 || startAt + issues.length >= total) break;
    startAt += maxResults;
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run jira.test.ts`  → Expected: PASS (all 6 tests).
Run: `cd shared/core && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add shared/core/jira.ts shared/core/jira.test.ts
git commit -m "feat(core): fetchBoardIssues with injected transport (pagination loop)"
```

---

### Task 3: Server delegates to core via axios transport

**Files:**
- Modify: `server/src/services/jira.ts`

**Interfaces:**
- Consumes: `fetchBoardIssues`, `JiraConfig`, `JiraIssueRaw`, `JiraHttp` from core.
- Produces: unchanged public API — `class JiraClient` (`boardId`, `fetchIssues(updatedSince?)`), `createJiraClients()`, `JiraIssueRaw` (re-exported).

- [ ] **Step 1: Rewrite `server/src/services/jira.ts`**

```ts
import axios from 'axios';
import { fetchBoardIssues } from '../../../shared/core/jira';
import type { JiraConfig, JiraIssueRaw, JiraHttp } from '../../../shared/core/jira';

export type { JiraIssueRaw };

const axiosHttp: JiraHttp = async ({ url, auth, params }) => {
  try {
    const { data } = await axios.get(url, { auth, params });
    return data;
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.errorMessages?.join(', ') ?? err.message;
    throw new Error(`Jira API error${status ? ` (${status})` : ''}: ${msg}`);
  }
};

export class JiraClient {
  readonly boardId: number;
  constructor(private cfg: JiraConfig) { this.boardId = cfg.boardId; }
  fetchIssues(updatedSince?: string): Promise<JiraIssueRaw[]> {
    return fetchBoardIssues(this.cfg, axiosHttp, updatedSince);
  }
}

export function createJiraClients(): JiraClient[] {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'] as const;
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }
  const raw = process.env.JIRA_BOARD_IDS ?? process.env.JIRA_BOARD_ID ?? '';
  const boardIds = raw.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
  if (boardIds.length === 0) throw new Error('Set JIRA_BOARD_IDS (comma-separated board IDs) in .env');

  return boardIds.map(boardId => new JiraClient({
    baseUrl: process.env.JIRA_BASE_URL!,
    email: process.env.JIRA_EMAIL!,
    apiToken: process.env.JIRA_API_TOKEN!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    boardId,
  }));
}
```

- [ ] **Step 2: Run server tests (parity gate)**

Run: `cd server && npx vitest run`
Expected: 0 failures; `jira.test.ts` passes UNCHANGED (do NOT edit it). It mocks `axios`; `axiosHttp` calls `axios.get(url, {auth, params})` so both its assertions still hold.

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` → clean.
Also confirm no lingering imports: `grep -rn "class JiraClient\|createJiraClients" server/src/services/sync.ts` still resolves (sync.ts imports `createJiraClients` — unchanged).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/jira.ts
git commit -m "refactor(server): JiraClient delegates to core fetchBoardIssues (axios transport)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Core + server suites**

Run: `cd shared/core && npx vitest run` → all green.
Run: `cd server && npx vitest run` → 0 failures (`jira.test.ts` unchanged & green).

- [ ] **Step 2: Typechecks**

Run: `cd shared/core && npx tsc --noEmit`; `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit` → all clean.

- [ ] **Step 3: Core purity check**

Run: `grep -rn "axios\|process.env\|require('fs')\|from 'fs'" shared/core/jira.ts` → no matches.

---

## Self-Review

**Spec coverage:**
- `parseJiraIssue` (ADF + changelog→transitions + assignee) → Task 1. ✓
- `buildJql` → Task 1. ✓
- `fetchBoardIssues` with injected transport (pagination) → Task 2. ✓
- `JiraHttp` transport type → Task 1. ✓
- Server `axiosHttp` preserves error format; `JiraClient`/`createJiraClients` unchanged API → Task 3. ✓
- No behavior change verified by unchanged `jira.test.ts` → Task 3 & 4. ✓
- Core purity (no axios/env) → Task 4 Step 3 + Global Constraints. ✓

**Type consistency:** `JiraConfig`, `JiraIssueRaw`, `JiraHttp` defined in Task 1, consumed in Tasks 2 & 3. `fetchBoardIssues(cfg, http, updatedSince?)` signature consistent between core (Task 2) and server caller (Task 3).

**Placeholder scan:** none — all code is inline.

**Out of scope (SP2):** mobile `fetch` transport + secure-store (SP4), Gemini classification (SP3), any `sync.ts` change (it uses the unchanged `createJiraClients`/`fetchIssues` API).
