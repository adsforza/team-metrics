# SP4c-2: Mobile transports (Jira fetch + Gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Create `mobile/lib/transports.ts` with `jiraHttpFetch: JiraHttp` (fetch + Basic auth) and `makeGeminiGenerate(apiKey, model?): GenerateFn` (SDK factory) — the mobile implementations of the core's injectable transports.

**Architecture:** These plug into the core's `fetchBoardIssues` (JiraHttp) and `classifyTallaBatch` (GenerateFn). SP4c-3 wires them into the direct-sync. The Jira error format matches the server's so the core's retry/error handling behaves identically.

**Tech Stack:** TypeScript, `fetch`/`URLSearchParams`/`AbortSignal.timeout` (RN built-ins), `@google/generative-ai`, jest. Imports `@teammetrics/core/jira` + `@teammetrics/core/classify`.

## Global Constraints

- Additive: new file only.
- Jira error must be `Error('Jira API error (<status>): <msg>')` so the core's 429 detection (`message.includes('429')`) still works.
- base64 for Basic auth: use `globalThis.btoa` if present, else a correct ASCII fallback (Jira email:token are ASCII).
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: `jiraHttpFetch` + `makeGeminiGenerate` (TDD)

**Files:** Create `mobile/lib/transports.ts`, `mobile/__tests__/transports.test.ts`.

**Interfaces:**
- Consumes: `JiraHttp` from `@teammetrics/core/jira`, `GenerateFn` from `@teammetrics/core/classify`, `GoogleGenerativeAI`.
- Produces: `jiraHttpFetch: JiraHttp`, `makeGeminiGenerate(apiKey, model?) → GenerateFn`.

- [ ] **Step 1: Write the failing test** `mobile/__tests__/transports.test.ts`

```ts
let mockGenerateContent: any;
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: (cfg: any) => ({ _cfg: cfg, generateContent: (...a: any[]) => mockGenerateContent(...a) }),
  })),
}));

import { jiraHttpFetch, makeGeminiGenerate } from '../lib/transports';

describe('jiraHttpFetch', () => {
  it('builds URL with params + Basic auth header and returns json', async () => {
    let capturedUrl = ''; let capturedInit: any = null;
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      capturedUrl = url; capturedInit = init;
      return { ok: true, json: async () => ({ issues: [], total: 0 }) };
    });
    const data = await jiraHttpFetch({ url: 'https://x.atlassian.net/rest/agile/1.0/board/7/issue', auth: { username: 'e@t.com', password: 'tok' }, params: { jql: 'project = OPS', startAt: 0 } });
    expect(data).toEqual({ issues: [], total: 0 });
    expect(capturedUrl).toContain('jql=project');
    expect(capturedInit.headers.Authorization).toBe('Basic ' + Buffer.from('e@t.com:tok').toString('base64'));
  });

  it('throws Jira API error (status) on non-ok', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({ errorMessages: ['rate'] }) }));
    await expect(jiraHttpFetch({ url: 'u', auth: { username: 'e', password: 't' }, params: {} }))
      .rejects.toThrow(/Jira API error \(429\)/);
  });
});

describe('makeGeminiGenerate', () => {
  it('calls generateContent with the model config and returns text', async () => {
    mockGenerateContent = jest.fn(async () => ({ response: { text: () => '[{"talla":"M","confidence":0.9}]' } }));
    const gen = makeGeminiGenerate('key123', 'gemini-2.0-flash-lite');
    const out = await gen('prompt', { systemInstruction: 'sys', maxOutputTokens: 40 });
    expect(out).toBe('[{"talla":"M","confidence":0.9}]');
    expect(mockGenerateContent).toHaveBeenCalledWith('prompt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/transports.test.ts` → FAIL ("jiraHttpFetch is not a function").

- [ ] **Step 3: Implement `mobile/lib/transports.ts`**

```ts
import type { JiraHttp } from '@teammetrics/core/jira';
import type { GenerateFn } from '@teammetrics/core/classify';
import { GoogleGenerativeAI } from '@google/generative-ai';

function base64(input: string): string {
  const g = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(input);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++);
    const c2 = input.charCodeAt(i++);
    const c3 = input.charCodeAt(i++);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    let e3 = ((c2 & 15) << 2) | (c3 >> 6);
    let e4 = c3 & 63;
    if (isNaN(c2)) { e3 = 64; e4 = 64; }
    else if (isNaN(c3)) { e4 = 64; }
    output += chars.charAt(e1) + chars.charAt(e2)
      + (e3 === 64 ? '=' : chars.charAt(e3))
      + (e4 === 64 ? '=' : chars.charAt(e4));
  }
  return output;
}

export const jiraHttpFetch: JiraHttp = async ({ url, auth, params }) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const full = `${url}?${qs.toString()}`;
  const token = base64(`${auth.username}:${auth.password}`);
  const res = await fetch(full, {
    headers: { Authorization: `Basic ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body: any = await res.json(); if (body?.errorMessages?.length) msg = body.errorMessages.join(', '); } catch { /* ignore */ }
    throw new Error(`Jira API error (${res.status}): ${msg}`);
  }
  return res.json();
};

export function makeGeminiGenerate(apiKey: string, model = 'gemini-2.0-flash-lite'): GenerateFn {
  const client = new GoogleGenerativeAI(apiKey);
  return async (prompt, { systemInstruction, maxOutputTokens }) => {
    const m = client.getGenerativeModel({ model, systemInstruction, generationConfig: { maxOutputTokens } });
    const result = await m.generateContent(prompt);
    return result.response.text();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/transports.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/transports.ts mobile/__tests__/transports.test.ts
git commit -m "feat(mobile): jiraHttpFetch + makeGeminiGenerate transports (RN)"
```

---

### Task 2: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures.
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors (pre-existing TabHeader error unrelated).
- [ ] **Step 3:** `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c2-export` → `iOS Bundled` OK (confirms transports.ts + `@google/generative-ai` bundle).

---

## Self-Review

**Spec coverage:** `jiraHttpFetch` (fetch + Basic auth via btoa/fallback + server-format error) → Task 1 Step 3; `makeGeminiGenerate` factory → Task 1 Step 3; tests for both → Task 1 Step 1. ✓
**Type consistency:** `jiraHttpFetch: JiraHttp` and `makeGeminiGenerate(): GenerateFn` match the core's transport types (SP2/SP3).
**Placeholder scan:** none — code inline; base64 fallback is complete.
**Out of scope:** wiring into direct-sync (SP4c-3), secure-store key injection (SP4d), mode switch (SP5).
