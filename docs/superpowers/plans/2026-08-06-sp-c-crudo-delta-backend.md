# SP-C: Mobile — crudo delta en backend mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que el backend mode del celu, además de mostrar los snapshots del server, baje el crudo (issues/transitions/members) delta de `GET /api/raw` y mantenga las tablas crudas calientes, para que el primer direct mode tras usar backend NO re-baje todo Jira. Las tallas que trae el server no se pisan sobre las locales y quedan marcadas como ya-en-server.

**Architecture:** Nuevo `upsertServerRaw(db, bundle)` que mergea el crudo del server (con talla) en las tablas crudas del mobile: nunca pisa una talla local con null (`COALESCE`), y marca `talla_pushed=1` cuando la talla viene del server. Un sentinela `board_sync[0]` guarda el `serverSyncedAt` del último pull de crudo. `directSync` calcula el `since` por board como `max(board_sync[boardId], board_sync[0])` (nuevo `getRawSince`), así arranca del punto que el server ya tenía. El pull de crudo se hace en `performSync` después del push de tallas.

**Tech Stack:** Expo/React Native + expo-sqlite + TypeScript; Jest (expo-sqlite y fetch mockeados).

## Global Constraints

- `GET /api/raw?since=<iso?>` (server, SP-A/SP-A.1) devuelve `{ issues, transitions, members, serverSyncedAt }`. `issues` traen `talla`/`talla_confidence`; el delta del server ya considera `max(updated_at, talla_updated_at)`.
- `board_sync` (PK `board_id`) se reutiliza: `board_id = 0` es el **sentinela** "crudo del server fresco hasta serverSyncedAt". No es un board real.
- El pull de crudo del backend es **best-effort**: un fallo se agrega a `errors` con endpoint `/api/raw`, no cambia okCount/failCount, no toca los snapshots.
- `upsertServerRaw` **no pisa** una talla local con null: `talla = COALESCE(excluded.talla, issues.talla)`. Marca `talla_pushed = 1` sólo cuando la talla viene del server (`excluded.talla IS NOT NULL`), si no conserva el valor local. Esto hace que una talla local ya reflejada por el server (round-trip tras el push de SP-B) quede marcada como enviada.
- `directSync` usa `getRawSince(db, boardId)` = el ISO más nuevo entre `board_sync[boardId]` y `board_sync[0]` (ambos son ISO `toISOString()` en UTC → comparación lexical válida).
- Tests del mobile: expo-sqlite y `fetch` mockeados; se asertan llamadas SQL/HTTP. La suite sigue verde.
- Los snapshots del backend mode (código actual de `performSync`) quedan **intactos**.

---

### Task 1: `upsertServerRaw` + `getRawSince` (db.ts)

**Files:**
- Modify: `mobile/lib/db.ts`
- Test: `mobile/__tests__/db.test.ts`

**Interfaces:**
- Produces:
  - Tipos:
    ```ts
    export interface RawIssue {
      id: string; title: string; description: string; status: string;
      assignee_id: string | null; talla: string | null; talla_confidence: number | null;
      created_at: string; updated_at: string; last_transition_at: string | null;
    }
    export interface RawTransition { issue_id: string; from_status: string; to_status: string; transitioned_at: string }
    export interface RawMember { id: string; display_name: string; email: string | null; avatar_url: string | null }
    export interface RawBundle { issues: RawIssue[]; transitions: RawTransition[]; members: RawMember[]; serverSyncedAt: string | null }
    ```
  - `upsertServerRaw(db, bundle: RawBundle): Promise<void>`
  - `getRawSince(db, boardId: number): Promise<string | undefined>`

- [ ] **Step 1: Escribir tests (fallan)**

Agregar a `mobile/__tests__/db.test.ts`:

```ts
import { upsertServerRaw, getRawSince } from '../lib/db';

describe('upsertServerRaw', () => {
  test('upsertea members, issues (con merge de talla) y transitions', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValue(null); // transición no existe -> se inserta
    (db.runAsync as jest.Mock).mockClear();
    await upsertServerRaw(db, {
      issues: [{ id: 'S-1', title: 't', description: '', status: 'Done', assignee_id: 'u1', talla: 'M', talla_confidence: 0.9, created_at: 'c', updated_at: 'u', last_transition_at: 'l' }],
      transitions: [{ issue_id: 'S-1', from_status: 'To Do', to_status: 'Done', transitioned_at: '2026-06-01T00:00:00Z' }],
      members: [{ id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null }],
      serverSyncedAt: '2026-06-01T00:05:00Z',
    });
    // team_members upsert
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INTO team_members'), expect.arrayContaining(['u1', 'Ana']));
    // issues upsert con COALESCE (no pisa talla local con null) y talla_pushed
    const issueCall = (db.runAsync as jest.Mock).mock.calls.find(c => String(c[0]).includes('INTO issues'));
    expect(issueCall).toBeTruthy();
    expect(String(issueCall![0])).toContain('COALESCE(excluded.talla, issues.talla)');
    expect(String(issueCall![0])).toContain('talla_pushed');
    // transición insertada
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INTO transitions'), ['S-1', 'To Do', 'Done', '2026-06-01T00:00:00Z']);
  });

  test('marca talla_pushed=1 cuando la talla viene del server; 0 cuando viene null', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValue(null);
    (db.runAsync as jest.Mock).mockClear();
    await upsertServerRaw(db, {
      issues: [
        { id: 'WITH', title: 't', description: '', status: 'Done', assignee_id: null, talla: 'L', talla_confidence: 0.8, created_at: 'c', updated_at: 'u', last_transition_at: null },
        { id: 'NULL', title: 't', description: '', status: 'Done', assignee_id: null, talla: null, talla_confidence: null, created_at: 'c', updated_at: 'u', last_transition_at: null },
      ],
      transitions: [], members: [], serverSyncedAt: null,
    });
    const calls = (db.runAsync as jest.Mock).mock.calls.filter(c => String(c[0]).includes('INTO issues'));
    // el arg de talla_pushed es el último parámetro del array de valores del INSERT
    const withPushed = calls.find(c => c[1].includes('WITH'))![1];
    const nullPushed = calls.find(c => c[1].includes('NULL'))![1];
    expect(withPushed[withPushed.length - 1]).toBe(1);
    expect(nullPushed[nullPushed.length - 1]).toBe(0);
  });
});

describe('getRawSince', () => {
  test('devuelve el ISO más nuevo entre board_sync[boardId] y board_sync[0]', async () => {
    const db = await getDb();
    // getBoardLastSync(boardId) -> primera llamada; getBoardLastSync(0) -> segunda
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce({ last_synced_at: '2026-06-01T00:00:00Z' })  // board
      .mockResolvedValueOnce({ last_synced_at: '2026-07-01T00:00:00Z' }); // sentinela
    const since = await getRawSince(db, 7);
    expect(since).toBe('2026-07-01T00:00:00Z');
  });

  test('devuelve el definido cuando el otro falta', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(null)                                        // board sin marca
      .mockResolvedValueOnce({ last_synced_at: '2026-07-01T00:00:00Z' }); // sentinela
    const since = await getRawSince(db, 7);
    expect(since).toBe('2026-07-01T00:00:00Z');
  });
});
```

- [ ] **Step 2: Correr → fallan**

Run: `cd mobile && npx jest db.test.ts`
Expected: FAIL (funciones/tipos no existen).

- [ ] **Step 3: Implementar `upsertServerRaw` + `getRawSince` en `mobile/lib/db.ts`**

Agregar los tipos del bloque Interfaces arriba, y:

```ts
export async function upsertServerRaw(db: SQLite.SQLiteDatabase, bundle: RawBundle): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const m of bundle.members) {
      await db.runAsync(
        `INSERT INTO team_members (id, display_name, email, avatar_url) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url`,
        [m.id, m.display_name, m.email, m.avatar_url],
      );
    }
    for (const i of bundle.issues) {
      const pushed = i.talla != null ? 1 : 0;
      await db.runAsync(
        `INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, last_transition_at, talla_pushed)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description, status=excluded.status,
           assignee_id=excluded.assignee_id, updated_at=excluded.updated_at, last_transition_at=excluded.last_transition_at,
           talla=COALESCE(excluded.talla, issues.talla),
           talla_confidence=COALESCE(excluded.talla_confidence, issues.talla_confidence),
           talla_pushed=CASE WHEN excluded.talla IS NOT NULL THEN 1 ELSE issues.talla_pushed END`,
        [i.id, i.title, i.description, i.status, i.assignee_id, i.talla, i.talla_confidence, i.created_at, i.updated_at, i.last_transition_at, pushed],
      );
    }
    for (const t of bundle.transitions) {
      const exists = await db.getFirstAsync(
        `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`,
        [t.issue_id, t.to_status, t.transitioned_at],
      );
      if (!exists) {
        await db.runAsync(
          `INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`,
          [t.issue_id, t.from_status, t.to_status, t.transitioned_at],
        );
      }
    }
  });
}

// El since efectivo para bajar de Jira: el más nuevo entre la última sync directa de este
// board y el sentinela board_sync[0] (crudo del server). Ambos son ISO UTC (toISOString) →
// comparación lexical válida.
export async function getRawSince(db: SQLite.SQLiteDatabase, boardId: number): Promise<string | undefined> {
  const board = await getBoardLastSync(db, boardId);
  const sentinel = await getBoardLastSync(db, 0);
  if (!board) return sentinel;
  if (!sentinel) return board;
  return board > sentinel ? board : sentinel;
}
```

- [ ] **Step 4: Correr → pasan**

Run: `cd mobile && npx jest db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/db.test.ts
git commit -m "feat(mobile): upsertServerRaw (merge de crudo del server) + getRawSince"
```

---

### Task 2: `fetchRaw` (api) + pull en `performSync` + `directSync` usa `getRawSince`

**Files:**
- Modify: `mobile/lib/api.ts` (nuevo `fetchRaw`)
- Modify: `mobile/lib/sync.ts` (pull de crudo en `performSync`)
- Modify: `mobile/lib/directSync.ts` (usar `getRawSince` en vez de `getBoardLastSync`)
- Test: `mobile/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `upsertServerRaw`, `getRawSince`, `getBoardLastSync`, `setBoardLastSync` (db.ts); `RawBundle` (db.ts).
- Produces: `fetchRaw(since?: string): Promise<RawBundle>`.

- [ ] **Step 1: Escribir tests (fallan)**

Agregar a `mobile/__tests__/sync.test.ts`. Extender `mockAllFetch` para que matchee `/api/raw`, y agregar un test que verifique que `performSync` baja el crudo, lo upsertea y setea el sentinela.

En la función `mockAllFetch`, agregar (antes del `return Promise.reject`):
```ts
    if (url.includes('/api/raw'))  return Promise.resolve({ ok: true, json: () => Promise.resolve({ issues: [], transitions: [], members: [], serverSyncedAt: '2026-06-21T00:05:00Z' }) });
```
(Va **antes** de la línea `if (url.includes('/api/metrics'))` no hace falta, `/api/raw` no colisiona; agregarlo en cualquier punto de la cadena está bien.)

Nuevo test:
```ts
test('performSync baja el crudo del server y setea el sentinela board_sync[0]', async () => {
  mockAllFetch();
  const db = await getDb();
  (db.runAsync as jest.Mock).mockClear();
  await performSync();
  // pegó a /api/raw
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/raw'), expect.anything());
  // seteó el sentinela board_sync con board_id 0 y el serverSyncedAt
  expect(db.runAsync).toHaveBeenCalledWith(
    expect.stringContaining('INTO board_sync'),
    [0, '2026-06-21T00:05:00Z'],
  );
});
```

- [ ] **Step 2: Correr → fallan**

Run: `cd mobile && npx jest sync.test.ts`
Expected: FAIL (no se pega a `/api/raw` / no se setea board_sync[0]).

- [ ] **Step 3: `fetchRaw` en `mobile/lib/api.ts`**

```ts
import type { RawBundle } from './db';

export async function fetchRaw(since?: string): Promise<RawBundle> {
  const base = await getBaseUrl();
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const res = await fetch(`${base}/api/raw${qs}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} /api/raw`);
  return res.json() as Promise<RawBundle>;
}
```

- [ ] **Step 4: Pull de crudo en `performSync` (mobile/lib/sync.ts)**

Agregar imports que falten (`fetchRaw` de `./api`; `upsertServerRaw`, `getBoardLastSync`, `setBoardLastSync` de `./db`). Después del bloque de push de tallas (SP-B) agregar:
```ts
// SP-C: mantener el crudo caliente para el próximo direct mode (best-effort).
try {
  const sentinel = await getBoardLastSync(db, 0);
  const raw = await fetchRaw(sentinel);
  await upsertServerRaw(db, raw);
  if (raw.serverSyncedAt) await setBoardLastSync(db, 0, raw.serverSyncedAt);
} catch (err) {
  errors.push({ endpoint: '/api/raw', message: String(err) });
}
```
(No tocar okCount/failCount.)

- [ ] **Step 5: `directSync` usa `getRawSince` (mobile/lib/directSync.ts)**

En el loop de boards, cambiar:
```ts
const since = await getBoardLastSync(db, boardCfg.boardId);
```
por:
```ts
const since = await getRawSince(db, boardCfg.boardId);
```
Actualizar el import: agregar `getRawSince` a lo importado de `./db` (y quitar `getBoardLastSync` del import sólo si ya no se usa en el archivo — `setBoardLastSync` sí se sigue usando).

- [ ] **Step 6: Correr → pasan**

Run: `cd mobile && npx jest sync.test.ts`
Expected: PASS.

- [ ] **Step 7: Suite completa + typecheck**

Run: `cd mobile && npx jest`
Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` (ignorar sólo el error pre-existente de `TabHeader`/`@react-navigation/bottom-tabs`).
Expected: jest verde; sin errores nuevos de tsc.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/api.ts mobile/lib/sync.ts mobile/lib/directSync.ts mobile/__tests__/sync.test.ts
git commit -m "feat(mobile): backend baja crudo delta (/api/raw) + direct usa getRawSince"
```

## Verification

```bash
cd mobile && npx jest        # todo verde (previos + nuevos)
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit   # sólo el error pre-existente de TabHeader
```

## Archivos críticos

- `mobile/lib/db.ts` — upsertServerRaw (merge de talla con COALESCE + talla_pushed), getRawSince, tipos RawBundle
- `mobile/lib/api.ts` — fetchRaw
- `mobile/lib/sync.ts` — pull de crudo + sentinela board_sync[0] en performSync
- `mobile/lib/directSync.ts` — since = getRawSince
- `mobile/__tests__/db.test.ts`, `mobile/__tests__/sync.test.ts` — tests
