# Mobile raw writers + board_sync — SP4c-1 — design

**Date:** 2026-08-03
**Status:** approved (design)

## Context

Sub-proyecto 4c-1 del objetivo mayor (mobile direct-to-Jira). Ya tenemos: el core
completo (SP1 + SP4c-0), el cliente Jira portable (SP2, `fetchBoardIssues` →
`JiraIssueRaw[]`), la clasificación portable (SP3), y en el mobile el schema crudo +
loaders (SP4b). Falta el **lado escritura**: persistir los `JiraIssueRaw[]` en las
tablas crudas del device, y llevar el cursor de sync incremental por board.

Espeja el `upsertBatch` del server (`server/src/services/sync.ts`), adaptado a la API
async de expo-sqlite.

## Goal (SP4c-1)

Agregar a `mobile/lib/db.ts`:
- `upsertRawIssues(db, issues: JiraIssueRaw[]): Promise<void>` — upsert de team_members
  + issues + transiciones nuevas, en una transacción.
- `board_sync` (tabla + `getBoardLastSync`/`setBoardLastSync`) para el fetch incremental.

## Arquitectura

### Schema (agregar a `initSchema`)
```sql
CREATE TABLE IF NOT EXISTS board_sync (
  board_id INTEGER PRIMARY KEY, last_synced_at TEXT
);
```
(Las tablas `issues`/`transitions`/`team_members` ya existen desde SP4b.)

### `upsertRawIssues(db, issues)` — espejo de `upsertBatch` (server sync.ts)
Dentro de `db.withTransactionAsync(...)`, por cada `issue: JiraIssueRaw`:
1. Si `issue.assignee` → upsert `team_members` (id, display_name, email, avatar_url) con `ON CONFLICT(id) DO UPDATE`.
2. `last_transition_at` = máx `transitioned_at` de `issue.transitions` (o null si no hay).
3. **Upsert `issues`** con `ON CONFLICT(id) DO UPDATE SET` de title/description/status/assignee_id/updated_at/last_transition_at — **NO** pisa `talla`/`talla_confidence** (se preservan; issues nuevos entran con talla NULL). Este es el mismo desacople descarga↔clasificación que aplicamos al server.
4. Insertar cada transición **solo si no existe** (dedup por `issue_id + to_status + transitioned_at`).

### board_sync helpers
- `getBoardLastSync(db, boardId): Promise<string | undefined>` — `SELECT last_synced_at FROM board_sync WHERE board_id = ?`.
- `setBoardLastSync(db, boardId, iso): Promise<void>` — upsert.

Tipos: `JiraIssueRaw` de `@teammetrics/core/jira`.

## No behavior change + Testing

- Aditivo (nueva tabla `board_sync` + nuevas funciones); nada existente se modifica.
- **Tests** (`mobile/__tests__/rawWriters.test.ts`, jest, con un `db` stub que registra
  `runAsync`/`getFirstAsync`/`withTransactionAsync`):
  - `upsertRawIssues`: upsert de team_member cuando hay assignee; upsert de issue con el
    `ON CONFLICT` que **preserva talla** (verificar que el SET no incluye talla); `last_transition_at`
    = máx de las transiciones; inserción de transiciones nuevas y **dedup** (no re-inserta una existente,
    usando el `getFirstAsync` de "exists").
  - `getBoardLastSync`/`setBoardLastSync`: get devuelve el valor; set hace el upsert correcto.

## Verificación

```bash
cd mobile && npm test
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
```

## Fuera de alcance (SP4c-1)

- Transportes del mobile (`fetch` JiraHttp + `geminiGenerate`) → SP4c-2.
- Direct-sync (orquestación fetch → upsertRawIssues → clasificar → computar → snapshots) → SP4c-3.
- secure-store + Ajustes (SP4d); switch de modo (SP5).
