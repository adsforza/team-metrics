# Portable metrics core — SP1 (vertical slice) — design

**Date:** 2026-07-31
**Status:** approved (design)

## Context

Objetivo mayor (del usuario): que la **app mobile funcione en cualquier lado con solo internet**, pegándole **directo a Jira** cuando el backend no está disponible (escenario demo), con **paridad total de métricas + clasificación**, y que **sincronice con el backend cuando vuelve a estar disponible**. No se hostea el backend (exige auth y expone datos sensibles); en direct mode las credenciales (token Jira + key Gemini) viven en el device con `expo-secure-store` — decisión consciente del usuario.

Eso implica **portar el motor de analítica adentro del mobile**. Es demasiado grande para un solo spec, así que se descompone en sub-proyectos (cada uno spec→plan→build):

1. **Core de métricas portable** ← *este spec (SP1)*
2. Cliente Jira portable (issues + changelog → transiciones)
3. Clasificación portable (Gemini como módulo compartido; verificar RN)
4. Direct mode en el mobile (cablear 1+2+3, expo-sqlite, Metro `watchFolders`, secure-store, config en Ajustes)
5. Switch de modo + reconciliación ("sync when back") + auto-sync al volver la conexión

SP1 se acota además a un **slice vertical**: portar 2 services representativos para probar el patrón, no los ~2492 líneas de una.

## Goal (SP1)

Crear `shared/core/` (TS puro, portable Node+RN) y portar la **lógica de cálculo** de **`metrics` (KPIs)** y **`scorecard`** (el más complejo) a funciones puras sobre datos en memoria. Refactorizar el server para usarlas. **Sin cambio de comportamiento** (los 80 tests del server siguen verdes) + tests unitarios nuevos del core.

## Arquitectura

### Estructura nueva
```
shared/core/
  package.json        # name "@teammetrics/core", TS puro, sin deps de runtime
  tsconfig.json
  types.ts            # tipos de I/O portables (abajo)
  stats.ts            # percentile, median  (movido tal cual de server/src/services/stats.ts)
  statusCategories.ts # taxonomía + categorize (movido tal cual)
  metrics.ts          # computeKpis(...)
  scorecard.ts        # computeScorecard(...) + makeDimension, resolveWindows, helpers puros
  *.test.ts           # vitest
```

**Reglas del core (no negociables):**
- Sin `better-sqlite3`, `fs`, `path`, ni ningún built-in de Node.
- **No lee `process.env`.** Todo valor de entorno (p.ej. `AGING_THRESHOLD_DAYS`) entra como parámetro.
- **No lee `Date.now()` implícito para lógica de ventana**: donde el resultado depende de "ahora" (aging cutoff, ventana default del scorecard), `now` se pasa como parámetro (default `new Date()` aceptable, pero explícito para testear).
- Funciones puras: mismas entradas → misma salida.

### Patrón load/compute
Cada service del server se parte en dos:
- `loadX(db, …) → filas`  — SQL con better-sqlite3, **queda en `server/`**.
- `computeX(filas, …) → resultado` — pura, **vive en `shared/core`**.
- El handler/route hace `load` y llama a `compute`.

### Tipos de I/O portables (`shared/core/types.ts`)
Formas mínimas que consumen los `compute*` (el server mapea sus filas a estas):
```ts
export interface CoreIssue {
  id: string; status: string; assignee_id: string | null;
  talla: 'S'|'M'|'L'|'XL'|null; created_at: string;
  last_transition_at: string | null;
}
export interface CoreTransition {
  issue_id: string; from_status: string | null; to_status: string; transitioned_at: string;
}
export interface CoreMember { id: string; display_name: string; email: string; avatar_url: string | null; }
export interface CoreFilter { assignee?: string; talla?: string; status?: string; from?: string; to?: string; }
```
Los tipos de resultado (`KPIMetrics`, `TeamScorecardResponse`, `DimensionValue`, etc.) se **mueven a `core/types.ts`** y `server/src/types.ts` los **re-exporta** (para no romper imports existentes del server y del client).

## Los dos ports

### `computeKpis(issues: CoreIssue[], transitions: CoreTransition[], params: CoreFilter, agingThresholdDays: number, now?: Date) → KPIMetrics`
Replica **exactamente** `getKPIs` (`server/src/services/metrics.ts:65`):
- `wip`: issues cuyo `status NOT IN (Done/Finalizada/Cancelled/Cancelado/To Do/Tareas por hacer/Backlog/Por Hacer)` (+ filtro assignee).
- `throughput`: issues con alguna transición a `Done/Finalizada` con `transitioned_at` en `[from,to]` (+ assignee).
- `cycle_time_p50/p85`: `computeCycleTimes` (port de `getCycleTimes:37`) — start = MIN(transición a estados de inicio, lista literal actual), end = transición a Done en ventana, filtra por `minDays` por talla, percentiles.
- `blocked_count`: WIP con `last_transition_at <= agingCutoff` (cutoff = `now - agingThresholdDays días`).

El server pasa `agingThresholdDays` leído de `process.env` (hoy lo lee el service; pasa a leerse en el handler/load).
**Preservar las listas de estados literales tal cual están hoy** (aunque dupliquen `statusCategories`); armonizarlas es una limpieza futura, fuera de alcance.

### `computeScorecard(issues, transitions, members, params, now?) → TeamScorecardResponse`
Port de `getTeamScorecard` (`server/src/services/scorecard.ts`). La lógica pura (makeDimension, activeRatio, hasRegression via `categorize`, delivery/predictability/focus/flow/regressions/blocked, contextOf, resolveWindows) ya es casi toda TS; lo que hoy es SQL (`completedIssues`, `activeWipAt`, `transitionsByIssue`) se reemplaza por equivalentes **en memoria** sobre `issues`/`transitions`:
- `completedIssues(issues, transitions, window, filter)`: issues con transición a activo (start) y a done (end) dentro de ventana.
- `activeWipAt(issues, transitions, day, filter)`: por cada issue, estado vigente al fin del día (última transición ≤ día, o `status`), contar los activos.
- Mantener el filtrado por `assignee`/`assignees`/`tallas` y las 6 dimensiones idénticas.

## Consumo

- `shared/core` tiene su `package.json` + `tsconfig.json` propios (sin deps de runtime; `vitest` como dev dep).
- El **server** lo importa por **ruta relativa** (mismo patrón que el client con `../../../server/src/types`) — p.ej. `import { computeKpis } from '../../../shared/core/metrics'`. Se ajusta el `tsconfig` del server si hace falta (`rootDir`/`include`). No se agregan workspaces en SP1.
- **Mobile NO se toca en SP1** (su consumo — Metro `watchFolders` — es SP4).

## No behavior change + Testing

- **Garantía:** los 80 tests actuales del server (`server/src/services/*.test.ts`, `routes.test.ts`) siguen pasando sin cambios, porque `getKPIs`/`getTeamScorecard` ahora delegan en `compute*` que producen la misma salida.
- **Tests nuevos del core** (`shared/core/*.test.ts`, vitest): casos unitarios de `computeKpis` y `computeScorecard` sobre datos en memoria (incluyendo los casos que hoy cubre `scorecard.test.ts`: ventanas, exclusión de miembros incompletos, flow efficiency, regresiones/bloqueados, filtro por talla).
- `stats.test.ts` y `statusCategories.test.ts` se mueven al core junto con su código.

## Verificación

```bash
cd shared/core && npx vitest run          # tests nuevos del core verdes
cd server && npx vitest run               # 80 verdes (sin cambios de comportamiento)
cd shared/core && npx tsc --noEmit        # core typecheck
cd server && npx tsc --noEmit             # server typecheck (nota: usar node node_modules/typescript/lib/tsc.js si el .bin está roto)
```

## Fuera de alcance (SP1)

- Resto de services (`forecast`, `bottleneck`, `wipRisk`, `comparison`, `getCFD`, `getThroughputWeekly`, `getCycleTimeByTalla`, `getAgingWIP`) — se portan como follow-on con el mismo patrón.
- Cliente Jira portable, clasificación portable, direct mode, Metro `watchFolders`, expo-sqlite, secure-store, switch/reconciliación (SP2–SP5).
- Armonizar listas de estados con `statusCategories` (limpieza futura).
- Convertir el repo a npm workspaces.

## Riesgos

- Reimplementar en memoria el SQL de `scorecard`/`getCycleTimes` puede cambiar resultados sutilmente (fechas con offset `-0300`, bordes de ventana). Mitigación: los 80 tests del server + tests del core con los mismos casos; comparar contra la salida actual.
