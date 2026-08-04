# Shared writeSnapshots (mobile) — SP4c-3a — design

**Date:** 2026-08-04
**Status:** approved (design)

## Context

Sub-proyecto 4c-3a del objetivo mayor (mobile direct-to-Jira). El modo backend
(`performSync` en `mobile/lib/sync.ts`) ya escribe los 12 snapshot tables a partir de
las respuestas de la API. El direct-sync (SP4c-3b) va a escribir **los mismos**
snapshots a partir del cómputo local. Para no duplicar el SQL de escritura y tener una
sola fuente de verdad, extraemos un `writeSnapshots(db, bundle, syncedAt)` compartido
por ambos caminos.

Decisión (usuario): opción A (writeSnapshots compartido) + descomponer SP4c-3 en
**3a (este)** = extraer/compartir la escritura, y **3b** = la orquestación `directSync`.

## Goal (SP4c-3a)

Extraer el cuerpo de la transacción de `performSync` a
`writeSnapshots(db, bundle: SnapshotBundle, syncedAt: string): Promise<void>`, y hacer
que `performSync` construya el `bundle` y lo llame. **Sin cambio de comportamiento**:
`mobile/__tests__/sync.test.ts` pasa sin tocar.

## Arquitectura

### `SnapshotBundle` (en `mobile/lib/snapshots.ts`, nuevo)
Todos los campos opcionales (backend omite los que fallaron; direct los provee todos):
```ts
export interface SnapshotBundle {
  kpi?: KPIMetrics;
  throughput?: ThroughputWeek[];
  team?: TeamScorecardResponse;
  aging?: AgingIssue[];
  wipRisk?: WipRiskResult;
  bottleneck?: BottleneckResult;
  forecast?: ForecastResult;
  cfd?: CFDPoint[];
  issues?: Issue[];
  byTalla?: TallaMetric[];
  comparisonWeeks?: string[];              // ventana a "prunear" en comparison_snapshot
  comparisons?: { week: string; result: ComparisonResult }[]; // los que hay para insertar
}
```

### `writeSnapshots(db, bundle, syncedAt)`
Mueve **verbatim** el cuerpo actual de `db.withTransactionAsync(...)` de `performSync`,
reemplazando los `result.status === 'fulfilled'` por `bundle.<campo> !== undefined`:
- kpi → `kpi_snapshot`; throughput → DELETE+insert `throughput_weekly`; team → DELETE+insert
  `scorecard_members` (`__team__` + members) + `scorecard_context_snapshot`; aging → DELETE+insert
  `aging_issues`; wipRisk/bottleneck/forecast → `INSERT OR REPLACE` sus snapshots; **prune**
  `comparison_snapshot WHERE week NOT IN (bundle.comparisonWeeks)` + insert `bundle.comparisons`;
  cfd → DELETE+insert `cfd_points`; issues → DELETE+insert `issues_snapshot`; byTalla →
  `INSERT OR REPLACE by_talla_snapshot`. Todo en una transacción, igual que hoy.
- **Importante (parity):** el prune usa `comparisonWeeks` (la VENTANA pedida, no solo los
  presentes), para preservar exactamente el comportamiento actual (una semana con fetch
  fallido no se borra).

### `performSync` refactorizado
Construye el `bundle` desde los `allSettled` (fulfilled → valor; rejected → omitido + push a
`errors`), con `comparisonWeeks = mondays` y `comparisons` = los fulfilled con su week; luego
`await writeSnapshots(db, bundle, syncedAt)`. El resto (okCount/failCount/LAST_SYNCED_KEY/config
fetch/return SyncResult) queda **igual**.

Tipos importados desde `@teammetrics/core/types` (donde ya viven tras SP4c-0) y `./types`
del mobile según corresponda (Issue vive en el mobile types).

## No behavior change + Testing

- **Gate:** `mobile/__tests__/sync.test.ts` pasa **sin modificar** (mockea fetch + expo-sqlite;
  verifica success/errors/okCount/LAST_SYNCED_KEY). El refactor no cambia qué se escribe ni el
  SyncResult.
- **Tests nuevos** (`mobile/__tests__/snapshots.test.ts`, con `db` stub que graba runAsync):
  `writeSnapshots` con un bundle parcial (solo algunos campos) escribe solo esos; con
  `comparisonWeeks` + `comparisons` prunea las semanas fuera de ventana e inserta las presentes.

## Verificación

```bash
cd mobile && npm test              # sync.test sin tocar, verde; snapshots.test nuevo verde
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
```

## Fuera de alcance (SP4c-3a)

- `directSync` (fetch → upsert → classify → compute → writeSnapshots) → SP4c-3b.
- secure-store + Ajustes (SP4d); switch de modo (SP5).
