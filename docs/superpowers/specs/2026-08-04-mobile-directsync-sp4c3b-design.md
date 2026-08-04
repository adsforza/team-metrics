# Direct-sync orchestration (mobile) — SP4c-3b — design

**Date:** 2026-08-04
**Status:** approved (design)

## Context

Sub-proyecto 4c-3b — el **integrador** del direct mode. Todas las piezas existen: core
con todas las métricas (SP1 + SP4c-0), cliente Jira portable (SP2) + transporte `fetch`
(SP4c-2), clasificación portable (SP3) + `makeGeminiGenerate` (SP4c-2), writers/loaders
crudos (SP4b/SP4c-1), y `writeSnapshots` compartido (SP4c-3a). Falta la función que los
orquesta end-to-end.

Decisiones confirmadas: (A) clasificación dentro de directSync best-effort; (B) mismos
filtros que performSync; (C) `directSync` recibe `config` como parámetro (secure-store =
SP4d).

## Goal (SP4c-3b)

`directSync(db, config, deps?)` que, sin backend, deja los snapshot tables listos para las
pantallas: fetch Jira → guardar crudo → clasificar → computar todo con el core → `writeSnapshots`.
La lógica "computar todo → bundle" se aísla en una función **pura** `computeBundle` para poder
testearla con arrays en memoria.

## Arquitectura

### Piezas nuevas

**`computeBundle(issues, transitions, members, filters, now) → SnapshotBundle`** (pura, en
`mobile/lib/directSync.ts` o `snapshots.ts`):
- Corre todos los `compute*` del core con `filters` (`{from,to,assignee}`), y arma el
  `SnapshotBundle` (SP4c-3a): kpi, throughput, team (scorecard), aging, wipRisk, bottleneck,
  forecast, cfd, byTalla, `comparisonWeeks = getLastNMondays(6)`, `comparisons` = `computeComparison`
  por cada semana, e `issues` = mapeo de `CoreIssue[]`/raw → `Issue` (shape que lee la tab Issues).
- Pura, sin DB ni red → unit-testeable.

**`updateIssueTallas(db, results: Map<string, {talla, confidence}>)`** (writer chico en `db.ts`):
`UPDATE issues SET talla=?, talla_confidence=? WHERE id=?` por cada resultado no-null.

**`readUnclassifiedIssues(db) → {id,title,description}[]`** (reader en `db.ts`): `SELECT ... FROM issues WHERE talla IS NULL`.

### `directSync(db, config, deps?)` (orquestador fino en `mobile/lib/directSync.ts`)
`config = { boards: JiraConfig[], geminiKey: string, filters: {from?,to?,assignee?} }`.
`deps` (inyectable para tests) = `{ http?: JiraHttp; makeGen?: (key)=>GenerateFn; now?: Date }`,
default a los reales (`jiraHttpFetch`, `makeGeminiGenerate`).
1. Por board: `since = getBoardLastSync(db, boardId)`; `raw = fetchBoardIssues(cfg, http, since)`;
   `upsertRawIssues(db, raw)`; `setBoardLastSync(db, boardId, syncedAt)`.
2. `pending = readUnclassifiedIssues(db)`; en batches de 20, `classifyTallaBatch(batch, makeGen(geminiKey))`
   → `updateIssueTallas(db, results)`. Best-effort (si la cuota corta, quedan null; se sigue).
3. `loadCoreIssues/Transitions/Members(db)`.
4. `bundle = computeBundle(issues, transitions, members, filters, now)`.
5. `writeSnapshots(db, bundle, syncedAt)`.
6. Retorna un `SyncResult`-like (`{ success, errors, syncedAt, okCount, failCount }`) para reusar el
   estado del `syncStore` (offline/aviso). Errores por board/clasificación se acumulan sin cortar.

Tipos: core desde `@teammetrics/core/*`; `Issue`/`SnapshotBundle` del mobile.

## Testing

- **`computeBundle`** (jest, arrays en memoria): dado un set chico de issues/transitions/members,
  el bundle tiene todos los campos poblados con los shapes correctos (kpi.wip, throughput[].week,
  team.members, comparisons con 6 semanas, issues mapeados). Es el grueso del test (pura).
- **`updateIssueTallas` / `readUnclassifiedIssues`** (db stub): SQL correcto.
- **`directSync`** (jest, con `deps` fake: `http` devuelve `JiraIssueRaw[]` canned, `makeGen` devuelve
  un `GenerateFn` fake, y un `db` stub que soporta upsert + loadCore*): verifica el orden
  fetch→upsert→classify→writeSnapshots y que arma/escribe el bundle. Test de wiring (el end-to-end
  real es en device).

## Verificación

```bash
cd mobile && npm test
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
cd mobile && npx expo export --platform ios --output-dir /tmp/sp4c3b-export   # bundle sanity
```

## Fuera de alcance (SP4c-3b)

- secure-store para `config` + UI de Ajustes (SP4d).
- Switch backend/direct según reachability + cablear `directSync` en el `syncStore` (SP5).
  (En SP4c-3b `directSync` queda listo y testeado, pero todavía no se llama desde la UI.)

## Riesgos

- El test de `directSync` necesita un `db` stub que devuelva lo "escrito" en `loadCore*`; si es
  muy engorroso, aceptar un test de wiring más liviano (spFalse sobre writeSnapshots) — el grueso
  testeable es `computeBundle`.
- Cuota de Gemini en el device: la clasificación es best-effort; las métricas computan igual con
  talla null (ya validado en el server).
