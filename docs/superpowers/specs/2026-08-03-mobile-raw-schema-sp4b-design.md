# Mobile raw schema + core loaders — SP4b — design

**Date:** 2026-08-03
**Status:** approved (design)

## Context

Sub-proyecto 4b del objetivo mayor (mobile direct-to-Jira). SP4a (spike) probó que
el mobile puede importar `shared/core` (dep `file:../shared/core` + Metro
`watchFolders`), que `@google/generative-ai` corre en RN, y que el celu llega
directo a Jira por `fetch`.

**Arquitectura confirmada del direct mode:** el mobile **persiste los datos crudos**
de Jira y **computa los mismos snapshots localmente** con el core, escribiéndolos en
los snapshot tables que las pantallas ya leen. Así las pantallas/hooks quedan **sin
tocar** (siempre leen snapshots; solo cambia la fuente: API del server vs cómputo
local), y como lo crudo queda persistido se puede recomputar offline al cambiar
filtros/semana sin volver a Jira.

SP4b es el primer ladrillo: **el schema crudo + los loaders** que alimentan el core.
Los writers (guardar crudo desde Jira), el direct-sync y el cómputo son SP4c.

## Goal (SP4b)

Agregar a la SQLite del mobile las tablas crudas (`issues`, `transitions`,
`team_members`, espejo del server) y los loaders que las leen y devuelven
`CoreIssue[]`/`CoreTransition[]`/`CoreMember[]` (los tipos que consumen las funciones
`compute*` del core). Aditivo: conviven con los snapshot tables actuales.

## Arquitectura

### Schema (en `initSchema`, `mobile/lib/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
  assignee_id TEXT, talla TEXT, talla_confidence REAL,
  created_at TEXT, updated_at TEXT, last_transition_at TEXT
);
CREATE TABLE IF NOT EXISTS transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT,
  from_status TEXT, to_status TEXT, transitioned_at TEXT
);
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY, display_name TEXT, email TEXT, avatar_url TEXT
);
```

Nota: `issues`/`team_members` (nombres crudos) son distintas de los snapshot tables
existentes (`issues_snapshot`, `scorecard_members`) → no colisionan. Es aditivo,
sin borrar nada.

### Loaders (en `mobile/lib/db.ts`, tipados con `@teammetrics/core/types`)

```ts
import type { CoreIssue, CoreTransition, CoreMember } from '@teammetrics/core/types';

export function loadCoreIssues(db): Promise<CoreIssue[]>       // SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues
export function loadCoreTransitions(db): Promise<CoreTransition[]> // SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
export function loadCoreMembers(db): Promise<CoreMember[]>     // SELECT id, display_name, email, avatar_url FROM team_members ORDER BY display_name
```

Cada loader hace `db.getAllAsync<...>(sql)` y devuelve las filas tipadas (el `talla`
TEXT castea a `Talla | null` estructuralmente). Son la contraparte mobile de los
`loadIssuesAndTransitions`/loader de miembros del server (SP1 Task 4/6).

## No behavior change + Testing

- Cambio **puramente aditivo**: nuevas tablas + nuevas funciones. Nada existente se
  modifica → los tests actuales del mobile siguen verdes.
- **Tests nuevos** (`mobile/__tests__/coreLoad.test.ts`, jest, mockeando `expo-sqlite`
  como el resto de los tests del mobile): mockear `getAllAsync` para devolver filas
  canned y verificar que cada loader (a) pide el SELECT con las columnas correctas y
  (b) devuelve el shape `Core*` esperado (incluido `talla` como `'M'`/`null`, `assignee_id`
  null, etc.).

## Verificación

```bash
cd mobile && npm test                                   # jest verde (existentes + nuevos)
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit   # resuelve @teammetrics/core vía symlink
```

## Fuera de alcance (SP4b)

- Writers (upsert de issues/transitions/members desde `JiraIssueRaw`) → SP4c.
- `board_sync` para sync incremental → SP4c.
- Direct-sync (fetch → guardar → clasificar → computar → snapshots) → SP4c.
- secure-store + UI de Ajustes → SP4d. Switch de modo → SP5.
