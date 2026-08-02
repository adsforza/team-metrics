# Portable classification (Gemini) — SP3 — design

**Date:** 2026-08-01
**Status:** approved (design)

## Context

Sub-proyecto 3 del objetivo mayor (mobile direct-to-Jira). SP1 dejó el motor de
métricas puro y SP2 el acceso a Jira portable, ambos con el patrón **transporte
inyectado**. SP3 hace lo mismo con la **clasificación de complejidad (talla
S/M/L/XL) con Gemini**: la lógica pura (prompt, parseo, retry) va a `shared/core`
y la llamada al SDK de Gemini queda como transporte inyectado por plataforma.

Así el **server no cambia de comportamiento** (sigue usando `@google/generative-ai`)
y el **mobile** podrá clasificar en direct mode (SP4) inyectando su propio
`generate`. El core **no importa el SDK**, por lo que la verificación de que
`@google/generative-ai` corre en React Native se difiere a SP4.

## Goal (SP3)

Extraer a `shared/core/classify.ts` el prompt, el parseo de la respuesta y la
orquestación de reintentos (backoff en 429), con la llamada al modelo inyectada
(`GenerateFn`). Refactorizar `server/src/services/claude.ts` para delegar en el
core usando un `geminiGenerate` basado en el SDK. **Sin cambio de comportamiento**
(`claude.test.ts` del server pasa sin tocar) + tests unitarios nuevos del core.

## Arquitectura

### `shared/core/classify.ts` (puro; sin `@google/generative-ai`, sin `process.env`, sin Node built-ins)

```ts
export const PROMPT_SYSTEM = `...`; // el rubric actual (S/M/L/XL) verbatim
export interface TallaResult { talla: Talla | null; confidence: number; razon: string; }
export type GenerateFn = (prompt: string, opts: { systemInstruction: string; maxOutputTokens: number }) => Promise<string>;
```

- `buildBatchPrompt(issues: {id;title;description}[]) → string` — port EXACTO:
  `issues.map((i, idx) => `${idx+1}. Title: ${i.title}\nDesc: ${i.description.slice(0,200)}`).join('\n\n')`.
- `parseBatchResponse(rawText: string, issues) → Map<string, TallaResult>` — limpieza
  (`rawText.trim().replace(/```json|```/g,'').trim()`) + `JSON.parse`; por índice,
  `talla = confidence >= 0.6 && validTallas.includes(rawTalla) ? rawTalla : null`,
  `confidence = p?.confidence ?? 0`, `razon = ''`. Si el `JSON.parse` falla → devuelve
  el fallback map (todos `{talla:null, confidence:0, razon:'not classified'}`).
- `classifyTallaBatch(issues, generate: GenerateFn, retries = 6, sleep = defaultSleep) → Promise<Map<string, TallaResult>>`
  — arma el prompt (buildBatchPrompt), `maxOutputTokens = issues.length * 40`; loop de
  `attempt` 0..retries: llama `generate(prompt, { systemInstruction: PROMPT_SYSTEM, maxOutputTokens })`,
  parsea con parseBatchResponse y retorna; en error detecta 429
  (`err.message?.includes('429') || err.status === 429`), parsea `"retryDelay":"(\d+)s"`
  (o backoff `2^(attempt+1) * 60_000`), `await sleep(wait)`, sigue; en error no-429 o al
  agotar → fallback map. `sleep` inyectable para tests.

### `server/src/services/claude.ts` (adapter)

- `getClient()` / `resetClient()` — leen `process.env.GEMINI_API_KEY`, **quedan**.
- `geminiGenerate: GenerateFn` — `getClient().getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite', systemInstruction, generationConfig: { maxOutputTokens } }).generateContent(prompt)` → devuelve `result.response.text()` (crudo; el core limpia y parsea). Deja propagar el error del SDK (el core maneja el 429).
- `classifyTallaBatch(issues, retries?)` → delega en `core.classifyTallaBatch(issues, geminiGenerate, retries)`.
- `classifyTalla(title, description)` — **sin cambios** (llama al `classifyTallaBatch` del server; usado por `sync.ts` y `routes/sync.ts`).
- Reexporta `TallaResult` desde el core.

## No behavior change + Testing

- **Gate de paridad:** `server/src/services/claude.test.ts` pasa **sin modificar**
  (mockea `@google/generative-ai`; `getGenerativeModel().generateContent()` → texto;
  verifica talla/confidence y la regla `<0.6 → null`). Como `geminiGenerate` usa
  `getGenerativeModel().generateContent()` y el core parsea igual, las aserciones se
  mantienen.
- **Tests nuevos del core** (`shared/core/classify.test.ts`, vitest):
  - `buildBatchPrompt`: numeración, truncado de descripción a 200 chars, separador.
  - `parseBatchResponse`: respuesta con fences ```` ```json ````; regla `<0.6 → null`;
    talla inválida → null; `JSON.parse` inválido → fallback.
  - `classifyTallaBatch`: happy path con `generate` fake; **retry en 429** con `generate`
    que falla N veces y un `sleep` fake (sin esperas), verificando que reintenta y luego
    tiene éxito; error no-429 → fallback.

## Verificación

```bash
cd shared/core && npx vitest run
cd server && npx vitest run               # claude.test.ts sin tocar, verde
cd shared/core && npx tsc --noEmit
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

## Fuera de alcance (SP3)

- `geminiGenerate` del mobile + verificar `@google/generative-ai` en RN + secure-store
  para la key (SP4).
- Direct mode / switch de modo (SP4/SP5).
- Cambios en `sync.ts` / `routes/sync.ts` (usan `classifyTalla`/`classifyTallaBatch`
  con firmas intactas).

## Riesgos

- El detalle del error 429 (formato `retryDelay`, `err.status`) debe replicarse en el
  core tal cual. Mitigación: test del retry con un `generate` que lanza un error 429
  sintético; el gate de paridad cubre el happy path.
- La limpieza del texto (fences) se mueve del server al core (parseBatchResponse); el
  server test lo cubre indirectamente (respuesta sin fences) y un test nuevo del core lo
  cubre con fences.
