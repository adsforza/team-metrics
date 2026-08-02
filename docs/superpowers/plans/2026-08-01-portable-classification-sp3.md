# SP3: Portable Classification (Gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Gemini talla-classification logic (prompt, response parsing, 429 retry/backoff) into `shared/core/classify.ts` with the model call injected (`GenerateFn`). Refactor the server to delegate via a `geminiGenerate` adapter, with **no behavior change**.

**Architecture:** Same injected-transport pattern as SP2. Core is pure (no `@google/generative-ai`, no `process.env`); the SDK call is injected. Server provides `geminiGenerate` (reads env for key/model) and keeps `classifyTalla`/`classifyTallaBatch`/`resetClient` public API. Mobile injects its own `generate` in SP4 (RN SDK compatibility verified there).

**Tech Stack:** TypeScript, vitest. Core imports only `./types` (for `Talla`).

## Global Constraints

- `shared/core/classify.ts` MUST NOT import `@google/generative-ai`, Node built-ins, or read `process.env`. `setTimeout`/`console` are allowed (cross-platform).
- **No behavior change**: `server/src/services/claude.test.ts` passes UNCHANGED (mocks the SDK; tests `classifyTalla` talla/confidence + the `<0.6 → null` rule).
- Preserve verbatim: `PROMPT_SYSTEM`, the batch prompt format, the parse rule (`confidence >= 0.6 && validTallas.includes(talla)`), the 429 detection + `retryDelay` parsing + backoff, the fallback map shape, and the operational `console.warn`/`console.error` lines.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Core tests: `cd shared/core && npx vitest run`. Server: `cd server && npx vitest run`.

---

### Task 1: Core prompt + parse (TDD)

**Files:**
- Create: `shared/core/classify.ts`, `shared/core/classify.test.ts`

**Interfaces:**
- Consumes: `Talla` from `./types`.
- Produces: `PROMPT_SYSTEM`, `TallaResult`, `GenerateFn`, `validTallas`; `buildBatchPrompt(issues) → string`; `parseBatchResponse(rawText, issues) → Map<string, TallaResult>`.

- [ ] **Step 1: Write the failing test** `shared/core/classify.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildBatchPrompt, parseBatchResponse } from './classify';

const issues = [
  { id: 'A', title: 'Deploy auth', description: 'x'.repeat(300) },
  { id: 'B', title: 'Fix typo', description: 'trivial' },
];

describe('buildBatchPrompt', () => {
  it('numbers issues, truncates description to 200 chars, joins with blank line', () => {
    const p = buildBatchPrompt(issues);
    expect(p).toContain('1. Title: Deploy auth');
    expect(p).toContain('2. Title: Fix typo');
    expect(p).toContain('Desc: ' + 'x'.repeat(200) + '\n'); // truncated to 200
    expect(p).not.toContain('x'.repeat(201));
    expect(p.split('\n\n')).toHaveLength(2);
  });
});

describe('parseBatchResponse', () => {
  it('maps talla/confidence and strips code fences', () => {
    const raw = '```json\n[{"talla":"M","confidence":0.9},{"talla":"S","confidence":0.8}]\n```';
    const out = parseBatchResponse(raw, issues);
    expect(out.get('A')).toEqual({ talla: 'M', confidence: 0.9, razon: '' });
    expect(out.get('B')).toEqual({ talla: 'S', confidence: 0.8, razon: '' });
  });
  it('nulls talla when confidence < 0.6 or talla invalid, keeping confidence', () => {
    const raw = '[{"talla":"L","confidence":0.4},{"talla":"Z","confidence":0.9}]';
    const out = parseBatchResponse(raw, issues);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0.4, razon: '' });
    expect(out.get('B')).toEqual({ talla: null, confidence: 0.9, razon: '' });
  });
  it('returns fallback map on invalid JSON', () => {
    const out = parseBatchResponse('not json', issues);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
    expect(out.get('B')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run classify.test.ts` → Expected: FAIL ("buildBatchPrompt is not a function").

- [ ] **Step 3: Implement `shared/core/classify.ts`** (part 1)

```ts
import type { Talla } from './types';

export const PROMPT_SYSTEM = `Sos un experto en DevOps. Clasificá la complejidad de cada issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON array válido, uno por issue en el mismo orden:
[{"talla":"M","confidence":0.85},{"talla":"S","confidence":0.9}]`;

export interface TallaResult { talla: Talla | null; confidence: number; razon: string; }
export type GenerateFn = (prompt: string, opts: { systemInstruction: string; maxOutputTokens: number }) => Promise<string>;

export const validTallas: Talla[] = ['S', 'M', 'L', 'XL'];

export function buildBatchPrompt(issues: Array<{ id: string; title: string; description: string }>): string {
  return issues.map((i, idx) => `${idx + 1}. Title: ${i.title}\nDesc: ${i.description.slice(0, 200)}`).join('\n\n');
}

function fallbackMap(issues: Array<{ id: string }>): Map<string, TallaResult> {
  return new Map(issues.map(i => [i.id, { talla: null as Talla | null, confidence: 0, razon: 'not classified' }]));
}

export function parseBatchResponse(rawText: string, issues: Array<{ id: string }>): Map<string, TallaResult> {
  const text = rawText.trim().replace(/```json|```/g, '').trim();
  let parsed: Array<{ talla?: string; confidence?: number }>;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('Batch parse error:', text.slice(0, 200));
    return fallbackMap(issues);
  }
  const out = new Map<string, TallaResult>();
  issues.forEach((issue, idx) => {
    const p = parsed[idx];
    const confidence = p?.confidence ?? 0;
    const rawTalla = p?.talla as Talla;
    out.set(issue.id, {
      talla: confidence >= 0.6 && validTallas.includes(rawTalla) ? rawTalla : null,
      confidence,
      razon: '',
    });
  });
  return out;
}

// (classifyTallaBatch added in Task 2 — export `fallbackMap` implicitly reused there)
```

Keep `fallbackMap` in the module for reuse by Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run classify.test.ts` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/core/classify.ts shared/core/classify.test.ts
git commit -m "feat(core): classify prompt + parse (buildBatchPrompt, parseBatchResponse)"
```

---

### Task 2: Core `classifyTallaBatch` with injected generate + retry (TDD)

**Files:**
- Modify: `shared/core/classify.ts` (add `classifyTallaBatch`)
- Modify: `shared/core/classify.test.ts` (add retry/happy/error tests)

**Interfaces:**
- Consumes: `buildBatchPrompt`, `parseBatchResponse`, `fallbackMap`, `PROMPT_SYSTEM`, `GenerateFn`.
- Produces: `classifyTallaBatch(issues, generate, retries=6, sleep?) → Promise<Map<string, TallaResult>>`.

- [ ] **Step 1: Write the failing test** (append to `shared/core/classify.test.ts`)

```ts
import { classifyTallaBatch } from './classify';
import type { GenerateFn } from './classify';

const two = [
  { id: 'A', title: 'a', description: '' },
  { id: 'B', title: 'b', description: '' },
];

describe('classifyTallaBatch', () => {
  it('happy path: calls generate once and parses', async () => {
    let calls = 0;
    const generate: GenerateFn = async () => { calls++; return '[{"talla":"M","confidence":0.9},{"talla":"L","confidence":0.7}]'; };
    const out = await classifyTallaBatch(two, generate);
    expect(calls).toBe(1);
    expect(out.get('A')?.talla).toBe('M');
    expect(out.get('B')?.talla).toBe('L');
  });

  it('retries on 429 (parsing retryDelay) then succeeds, using injected sleep', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    let n = 0;
    const generate: GenerateFn = async () => {
      if (n++ === 0) { const e: any = new Error('[429 Too Many Requests] "retryDelay":"3s"'); throw e; }
      return '[{"talla":"S","confidence":0.9},{"talla":"S","confidence":0.9}]';
    };
    const out = await classifyTallaBatch(two, generate, 6, sleep);
    expect(n).toBe(2);              // failed once, retried once
    expect(waits).toEqual([8000]);  // (3 + 5) * 1000
    expect(out.get('A')?.talla).toBe('S');
  });

  it('non-429 error returns fallback without retrying', async () => {
    let calls = 0;
    const generate: GenerateFn = async () => { calls++; throw new Error('boom'); };
    const out = await classifyTallaBatch(two, generate, 6, async () => {});
    expect(calls).toBe(1);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd shared/core && npx vitest run classify.test.ts` → Expected: FAIL ("classifyTallaBatch is not a function").

- [ ] **Step 3: Implement `classifyTallaBatch`** (append to `shared/core/classify.ts`)

```ts
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function classifyTallaBatch(
  issues: Array<{ id: string; title: string; description: string }>,
  generate: GenerateFn,
  retries = 6,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Map<string, TallaResult>> {
  const prompt = buildBatchPrompt(issues);
  const maxOutputTokens = issues.length * 40;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await generate(prompt, { systemInstruction: PROMPT_SYSTEM, maxOutputTokens });
      return parseBatchResponse(text, issues);
    } catch (err: any) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (is429 && attempt < retries) {
        const retryMatch = err.message?.match(/"retryDelay":"(\d+)s"/);
        const wait = retryMatch ? (parseInt(retryMatch[1]) + 5) * 1000 : Math.pow(2, attempt + 1) * 60_000;
        console.warn(`Gemini 429 – esperando ${wait / 1000}s (intento ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      console.error('Gemini batch error:', err.message);
      return fallbackMap(issues);
    }
  }
  return fallbackMap(issues);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd shared/core && npx vitest run classify.test.ts` → Expected: PASS (6 tests).
Run: `cd shared/core && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add shared/core/classify.ts shared/core/classify.test.ts
git commit -m "feat(core): classifyTallaBatch with injected generate + 429 retry"
```

---

### Task 3: Server adapter delegates to core

**Files:**
- Modify: `server/src/services/claude.ts`

**Interfaces:**
- Consumes: `classifyTallaBatch` (core), `TallaResult`, `GenerateFn` from `../../../shared/core/classify`.
- Produces: unchanged public API — `classifyTalla`, `classifyTallaBatch`, `resetClient`, `TallaResult`.

- [ ] **Step 1: Rewrite `server/src/services/claude.ts`**

```ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { classifyTallaBatch as coreClassifyTallaBatch } from '../../../shared/core/classify';
import type { TallaResult, GenerateFn } from '../../../shared/core/classify';

export type { TallaResult };

let _client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _client;
}
export function resetClient(): void { _client = null; }

const geminiGenerate: GenerateFn = async (prompt, { systemInstruction, maxOutputTokens }) => {
  const model = getClient().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    systemInstruction,
    generationConfig: { maxOutputTokens },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
};

export function classifyTallaBatch(
  issues: Array<{ id: string; title: string; description: string }>,
  retries = 6,
): Promise<Map<string, TallaResult>> {
  return coreClassifyTallaBatch(issues, geminiGenerate, retries);
}

// Mantener compatibilidad con sync.ts existente
export async function classifyTalla(title: string, description: string): Promise<TallaResult> {
  const results = await classifyTallaBatch([{ id: '_', title, description }]);
  return results.get('_') ?? { talla: null, confidence: 0, razon: 'error' };
}
```

- [ ] **Step 2: Run server tests (parity gate)**

Run: `cd server && npx vitest run`
Expected: 0 failures; `claude.test.ts` passes UNCHANGED (do NOT edit it). The mock's `getGenerativeModel().generateContent()` is called by `geminiGenerate`; the core parses; `classifyTalla` returns the same talla/confidence and applies `<0.6 → null`.

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` → clean. (`routes/sync.ts` and `services/sync.ts` import `classifyTallaBatch`/`classifyTalla` — signatures unchanged.)

- [ ] **Step 4: Commit**

```bash
git add server/src/services/claude.ts
git commit -m "refactor(server): classify delegates to core (geminiGenerate adapter)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Suites**

Run: `cd shared/core && npx vitest run` → all green.
Run: `cd server && npx vitest run` → 0 failures (`claude.test.ts` unchanged & green).

- [ ] **Step 2: Typechecks**

Run: `cd shared/core && npx tsc --noEmit`; `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit` → clean.

- [ ] **Step 3: Core purity**

Run: `grep -nE "@google/generative-ai|process.env|from 'fs'" shared/core/classify.ts` → no matches.

---

## Self-Review

**Spec coverage:**
- `PROMPT_SYSTEM`, `buildBatchPrompt`, `parseBatchResponse` (fences, `<0.6→null`, invalid talla, parse-error fallback) → Task 1. ✓
- `classifyTallaBatch` with injected `generate` + 429 retry (retryDelay parse, backoff) + injectable `sleep` → Task 2. ✓
- Server `geminiGenerate` adapter; `classifyTalla`/`classifyTallaBatch`/`resetClient` unchanged API → Task 3. ✓
- No behavior change via unchanged `claude.test.ts` → Task 3 & 4. ✓
- Core purity (no SDK/env) → Task 4 Step 3 + Global Constraints. ✓
- Operational logs preserved (`console.warn`/`console.error`) → Tasks 1 & 2. ✓

**Type consistency:** `TallaResult`, `GenerateFn` defined in Task 1, consumed in Tasks 2 & 3. `classifyTallaBatch(issues, generate, retries?, sleep?)` (core, Task 2) vs server wrapper `classifyTallaBatch(issues, retries?)` (Task 3) — server wrapper injects `geminiGenerate`, consistent.

**Placeholder scan:** none — all code inline. `Talla` comes from `shared/core/types.ts` (created in SP1).

**Out of scope (SP3):** mobile `geminiGenerate` + RN SDK verification + secure-store (SP4); direct mode/switch (SP4/SP5); `sync.ts`/`routes/sync.ts` changes (unchanged API).
