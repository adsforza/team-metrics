# Mobile transports (Jira fetch + Gemini) — SP4c-2 — design

**Date:** 2026-08-03
**Status:** approved (design)

## Context

Sub-proyecto 4c-2 del objetivo mayor (mobile direct-to-Jira). El core define dos
"transportes" inyectables: `JiraHttp` (SP2, para `fetchBoardIssues`) y `GenerateFn`
(SP3, para `classifyTallaBatch`). El server ya tiene sus implementaciones (axios y el
SDK). SP4c-2 crea las **implementaciones del mobile** (RN), que SP4c-3 cableará en el
direct-sync. SP4a ya probó en runtime que `fetch` llega a Jira y que el SDK de Gemini
corre en RN.

## Goal (SP4c-2)

Crear `mobile/lib/transports.ts` con:
- `jiraHttpFetch: JiraHttp` — implementación `fetch` + Basic auth, con el mismo mapeo de
  error que el `axiosHttp` del server.
- `makeGeminiGenerate(apiKey, model?): GenerateFn` — factory que envuelve
  `@google/generative-ai`.

## Arquitectura

### `jiraHttpFetch: JiraHttp`
Firma del core: `(req: { url; auth: { username; password }; params }) => Promise<data>`.
- Construir URL con query desde `req.params` (`URLSearchParams` o encoding manual).
- Header `Authorization: Basic <base64(username:password)>`. **base64 en RN:** usar
  `global.btoa` si existe; fallback a un encoder mínimo (Hermes no garantiza `btoa`).
- `fetch(url, { headers, signal: AbortSignal.timeout(...) })`; si `!res.ok` lanzar
  `Error(`Jira API error (${res.status}): ${msg}`)` (mismo formato que el server, para que
  el manejo/retry del core sea idéntico); si ok, `return res.json()`.
- No necesita config propia (el `auth` viene en el request, armado por `fetchBoardIssues`
  desde el `JiraConfig`).

### `makeGeminiGenerate(apiKey: string, model = 'gemini-2.0-flash-lite'): GenerateFn`
Devuelve un `GenerateFn` `(prompt, { systemInstruction, maxOutputTokens }) => Promise<string>`
idéntico al `geminiGenerate` del server:
`new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, systemInstruction, generationConfig: { maxOutputTokens } }).generateContent(prompt)` → `result.response.text()`.
La `apiKey` se inyecta al construir (viene de secure-store en SP4d).

Tipos: `JiraHttp` de `@teammetrics/core/jira`, `GenerateFn` de `@teammetrics/core/classify`.

## Testing

- **`jiraHttpFetch`** (jest, mock `global.fetch`):
  - arma la URL con los params, incluye header `Authorization: Basic ...` derivado de `req.auth`,
    y devuelve el JSON parseado en el happy path.
  - `res.ok === false` → lanza error con el formato `Jira API error (<status>): ...`.
- **`makeGeminiGenerate`** (jest, mock `@google/generative-ai` como el `claude.test` del server):
  - el `GenerateFn` retornado llama `getGenerativeModel(...).generateContent(prompt)` y devuelve
    `result.response.text()`; pasa `model`/`systemInstruction`/`maxOutputTokens` correctos.

## Verificación

```bash
cd mobile && npm test
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c2-export   # bundle sanity (fetch/SDK)
```

## Fuera de alcance (SP4c-2)

- Cablear los transportes en el direct-sync (fetch → upsert → classify → compute → snapshots) → SP4c-3.
- Leer la `apiKey` (y credenciales Jira) de secure-store + UI de Ajustes → SP4d.
- Switch de modo backend/direct → SP5.

## Riesgos

- base64 para Basic auth en RN/Hermes: `btoa` puede no existir → incluir fallback y confirmar
  en el device (SP4c-3 / corrida real). El resto ya se validó en SP4a (fetch a Jira, SDK en RN).
