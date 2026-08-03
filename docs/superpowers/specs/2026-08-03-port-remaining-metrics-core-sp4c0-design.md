# Port remaining metrics to core — SP4c-0 — design

**Date:** 2026-08-03
**Status:** approved (design)

## Context

Prerequisito de la **paridad total** del direct mode (SP4c). SP1 portó solo KPIs +
scorecard al core (slice vertical). Las demás métricas siguen **solo en SQL del
server**, así que el direct-sync del mobile no puede computarlas todavía. SP4c-0
porta las **8 funciones restantes** a `shared/core` con el **mismo patrón load/compute
de SP1**, sin cambio de comportamiento. Al terminar, el core tiene TODAS las métricas.

## Goal (SP4c-0)

Extraer la lógica de cálculo de estas 8 funciones a `shared/core` (funciones puras
sobre `CoreIssue[]`/`CoreTransition[]` en memoria), y refactorizar el server para
delegar (load SQL + compute core). Gate de paridad: los tests del server existentes
pasan **sin tocar**.

## Funciones a portar

De `server/src/services/metrics.ts`:
1. `getThroughputWeekly` → `computeThroughputWeekly(issues, transitions, params, now?)` (ya casi todo JS: `weekStart` en JS).
2. `getCFD` → `computeCFD(issues, transitions, params, now?)` (loop por día + `toBucket`; estado vigente por día como `activeWipAt` del scorecard).
3. `getAgingWIP` → `computeAgingWIP(issues, params, now?)` (ya JS: `days_in_status`; necesita title/talla/status/created_at/last_transition_at).
4. `getCycleTimeByTalla` → `computeCycleTimeByTalla(issues, transitions, params)` (envuelve `computeCycleTimes` que ya está en el core + `percentile`).

Standalone:
5. `forecast.ts` `getForecast` → `computeForecast(..., rng?, now?)` — Monte Carlo; el RNG **ya es inyectable** (`opts.rng ?? Math.random`) → el core lo recibe como parámetro (default `Math.random`), determinismo preservado.
6. `bottleneck.ts` `getBottleneck` → `computeBottleneck(...)` — el más grande (233 líneas); el implementer transcribe leyendo el source, swapping SQL por in-memory.
7. `wipRisk.ts` `getWipRisk` → `computeWipRisk(..., now?)`.
8. `comparison.ts` `getComparison` → `computeComparison(..., now?)` (ya tiene filtro `assignee`).

## Patrón (idéntico a SP1)

- `computeX(rows..., params, now?/rng?)` puro en `shared/core` (sin `better-sqlite3`, sin `process.env`, sin `Date.now()`/`Math.random()` implícitos → `now`/`rng` como parámetros).
- El server: `loadX(db) → filas` (SQL) + llama a `computeX`. Cada loader carga las columnas que la función necesita (p.ej. aging/bottleneck necesitan title, wipRisk necesita created_at/last_transition_at para la edad).
- Reutilizar helpers ya en el core (`stats`, `statusCategories`, `computeCycleTimes`, ventanas/`eachDay` si aplica — extraer a un módulo compartido si hace falta).

## Tipos

Mover a `shared/core/types.ts` los tipos de resultado que producen estas funciones
(`ThroughputWeek`, `CFDPoint`, `AgingIssue`, `TallaMetric`, `ForecastResult` + sub-tipos,
`BottleneckResult` + sub-tipos, `WipRiskResult` + sub-tipos, `ComparisonResult` +
`ComparisonPeriod`) y **re-exportarlos desde `server/src/types.ts`** (como en SP1), para
no romper imports del server ni del client.

## No behavior change + Testing

- **Gate de paridad:** los tests del server (`forecast.test.ts`, `bottleneck.test.ts`,
  `wipRisk.test.ts`, `comparison.test.ts`, `metrics.test.ts`) pasan **sin modificar** —
  prueban las funciones `getX` públicas, que ahora delegan en el core.
- **Tests nuevos del core** por cada `computeX` (vitest), portando/mirroreando los casos
  del test del server correspondiente sobre datos en memoria (especialmente forecast con
  `rng` fijo y bottleneck).

## Verificación

```bash
cd shared/core && npx vitest run
cd server && npx vitest run          # todos verdes, tests sin tocar
cd shared/core && npx tsc --noEmit
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

## Fuera de alcance (SP4c-0)

- Writers (JiraIssueRaw → tablas crudas) + `board_sync` (SP4c-1).
- Transportes del mobile `fetch`/`geminiGenerate` (SP4c-2).
- Direct-sync + escritura de snapshots locales (SP4c-3).
- secure-store + Ajustes (SP4d); switch de modo (SP5).

## Riesgos

- `bottleneck` y `forecast` son los ports más densos; mitigación: el gate de paridad
  (tests del server) + tests del core con `rng` fijo.
- `getCFD`/`activeWipAt`-style: preservar la semántica de "estado vigente al fin del día"
  y comparaciones de timestamp como string (como SQLite), igual que se hizo en scorecard (SP1).
