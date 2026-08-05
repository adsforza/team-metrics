# Sync incremental unificado + push de tallas + progreso — Design

**Fecha:** 2026-08-05
**Estado:** aprobado (diseño); pendiente review del spec por el usuario.

## Problema

El mobile tiene dos modos de sync que hoy están desacoplados:

- **backend mode** (`mobile/lib/sync.ts::performSync`): baja **snapshots ya calculados** del
  server (`/api/metrics`, `/api/team`, …) y guarda **solo** las tablas snapshot. No llena las
  tablas crudas (`issues`/`transitions`) ni marca `board_sync`.
- **direct mode** (`mobile/lib/directSync.ts::directSync`): baja crudo de Jira **incremental** por
  board usando `board_sync` (`getBoardLastSync`), llena crudo + snapshots, marca `board_sync`.

Consecuencia observada por el usuario: al pasar de backend → direct, como backend nunca dejó crudo
ni `board_sync`, el direct hace un **fetch completo de Jira**. Además, el trabajo de clasificación
(talla) que el celu hace con Gemini en direct mode **no llega al server**, que entonces re-gasta su
propia cuota de Gemini clasificando lo mismo. Y durante el sync el celu solo muestra una ruedita,
sin señal de avance.

## Objetivos (confirmados con el usuario)

1. **Delta siempre**: al cambiar de modo, no re-bajar todo de Jira; traer solo lo que falta.
2. **Push de tallas celu → server**: mandarle al server las clasificaciones hechas offline para que
   no re-gaste cuota. El **crudo NO se pushea** (el server lo baja solo del mismo Jira).
3. **Progreso visible** durante el sync (no solo la ruedita).

## Decisión de arquitectura: **Híbrido** (menos riesgo)

Backend mode **sigue mostrando los snapshots del server** (código actual intacto) y **además** baja
el crudo delta en segundo plano para mantener las tablas crudas listas para direct. Se evita
reescribir el camino de backend (que anda) y se acepta algo de red redundante.

Alternativas descartadas: *Unificar* (backend computa local desde crudo; más limpio pero refactor
grande y riesgoso) y *Mínimo* (solo acotar el primer fetch de direct; no cumple "mostrar lo del
server + solo el delta").

## Diseño

### A. Push de tallas (celu → server)

- **Mobile (schema):** nueva columna `talla_pushed INTEGER NOT NULL DEFAULT 0` en la tabla `issues`
  (migración idempotente vía `ALTER TABLE` con guardia). `updateIssueTallas` deja `talla_pushed=0`
  al grabar una talla clasificada localmente. `upsertRawIssues` no la toca (default 0 para nuevas
  filas; las filas existentes conservan su valor).
- **Mobile (backend sync):** paso nuevo — leer `SELECT id, talla, talla_confidence FROM issues
  WHERE talla IS NOT NULL AND talla_pushed = 0`; si hay, `POST /api/tallas`; al 200, marcar esos ids
  `talla_pushed = 1`.
- **Server:** `POST /api/tallas` con body `Array<{ id: string; talla: 'S'|'M'|'L'|'XL';
  confidence: number }>`. Ejecuta, por cada item, `UPDATE issues SET talla=?, talla_confidence=?
  WHERE id=? AND talla IS NULL` — **solo llena huecos**, nunca pisa una talla que el server ya tenga.
  Responde `{ updated: number }`. Validar talla contra el set permitido; ignorar ids desconocidos.

### B. Crudo delta en backend mode

- **Server:** `GET /api/raw?since=<iso?>` → `{ issues: RawIssue[]; transitions: RawTransition[];
  members: RawMember[]; serverSyncedAt: string | null }`.
  - `issues`: `WHERE updated_at >= since` (o todos si no viene `since`). Campos: `id, title,
    description, status, assignee_id, talla, talla_confidence, created_at, updated_at,
    last_transition_at`.
  - `transitions`: las de esos issues (`WHERE issue_id IN (...)`): `issue_id, from_status,
    to_status, transitioned_at`. Semántica de reemplazo por-issue (igual que `upsertRawIssues`).
  - `members`: todos (`id, display_name, email, avatar_url`).
  - `serverSyncedAt`: `finished_at` del último `sync_log` con `error IS NULL` (o null si nunca).
- **Mobile (backend sync, en segundo plano tras los snapshots):** bajar
  `GET /api/raw?since=<board_sync[0] ?? ''>`, upsert al crudo (reusar/adaptar la lógica de
  `upsertRawIssues`), y setear la **marca sentinela** `board_sync[0] = serverSyncedAt` (si no es
  null). `board_id = 0` no es un board real → sirve de marca global "crudo del server fresco hasta".
- **Mobile (direct mode):** el `since` por board pasa a ser
  `max(getBoardLastSync(boardId), getBoardLastSync(0))`. Así, tras usar backend, el primer direct
  arranca desde lo que el server ya tenía y solo trae de Jira lo posterior.
- Nota: usar `serverSyncedAt` (no `now`) como marca evita saltear issues de Jira más nuevos que la
  data del server cuando el cron del server está atrasado.

### C. Progreso visible

- **`syncStore`:** nuevo estado `progress: { label: string; current?: number; total?: number } |
  null`. Se limpia (`null`) al terminar el sync.
- **`performSync` / `directSync` / `directReclassify`:** aceptan un callback opcional
  `onProgress?(p: { label: string; current?: number; total?: number }): void` y lo llaman en cada
  paso relevante:
  - backend: "Bajando métricas…" → "Bajando crudo…" → "Enviando tallas (N)…".
  - direct: "Bajando board i/N…" → "Clasificando lote i/N" → "Calculando…" → "Enviando tallas (N)…".
- **UI:** `SyncHeader` y la sección Sincronización de `ajustes.tsx` muestran `progress.label` (y una
  barra fina si hay `current`/`total`) mientras `loading`, en vez de solo el spinner.

## Decomposición en sub-proyectos

Cada uno con su propio spec/plan y ciclo SDD; cada uno deja software testeable.

- **SP-A — Server: endpoints.** `GET /api/raw` + `POST /api/tallas`. Server-only, cubierto con
  supertest. No cambia el mobile. Es prerequisito de SP-B y SP-C.
- **SP-B — Mobile: push de tallas.** Columna `talla_pushed` + paso de push en backend sync + helper
  de api. Depende de SP-A (`POST /api/tallas`).
- **SP-C — Mobile: crudo delta en backend.** Pull de `/api/raw`, upsert, sentinela `board_sync[0]`,
  y el `max(...)` en el `since` de direct. Depende de SP-A (`GET /api/raw`).
- **SP-D — Progreso.** `onProgress` en los orquestadores + estado en `syncStore` + UI. Independiente
  de los demás (se puede hacer en cualquier orden).

## Gate de paridad

Los tests existentes (server + mobile, hoy 57 mobile) siguen verdes sin cambios de comportamiento en
lo que no toca cada SP. `GET /api/raw` y `POST /api/tallas` son aditivos. El camino de snapshots de
backend mode queda intacto (SP-C solo agrega el pull de crudo en paralelo).

## Deuda previa a limpiar (no parte de esta iniciativa, pero anotada)

En `ajustes.tsx` quedó scaffolding de debug del device: el botón "Probar conexión" muestra hashes
del token/email **hardcodeados** (`394bbe4b`/`496ac13c`) que son del token actual. Antes de commitear
el trabajo de debug, quitar la referencia hardcodeada (dejar solo longitud + hash del valor guardado
para autochequeo, sin el "bueno" fijo).
