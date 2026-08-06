# SP-B: Mobile — push de tallas al server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que el celu le mande al server las tallas que clasificó localmente (direct mode) para que el server no re-gaste cuota de Gemini. En cada backend sync, empujar las tallas pendientes vía `POST /api/tallas` y marcarlas como enviadas.

**Architecture:** Nueva columna `talla_pushed` en la tabla `issues` del mobile (0 = clasificada localmente y pendiente de push; 1 = ya en el server / vino del server). `updateIssueTallas` marca 0 al clasificar. En `performSync` (backend mode) se leen las pendientes, se hace `POST /api/tallas`, y al 200 se marcan 1. Best-effort: un fallo de push se registra pero no rompe el sync.

**Tech Stack:** Expo/React Native + expo-sqlite + TypeScript; Jest (expo-sqlite y fetch mockeados).

## Global Constraints

- El endpoint `POST /api/tallas` ya existe en el server (SP-A): body `Array<{ id, talla, confidence }>`, responde `{ updated }`, es fill-only.
- Columna `talla_pushed INTEGER NOT NULL DEFAULT 0` agregada en el `CREATE TABLE IF NOT EXISTS issues` (DBs nuevas) **y** con migración idempotente `PRAGMA table_info`-guardada (DBs existentes), dentro de `getDb()`.
- `updateIssueTallas` setea `talla_pushed=0` al escribir una talla (clasificación local → pendiente de push).
- `upsertRawIssues` NO toca `talla_pushed` (ya omite talla/talla_confidence del ON CONFLICT; misma lógica).
- El push es **best-effort**: un fallo se agrega a `errors` con endpoint `/api/tallas` pero NO cambia `okCount`/`failCount` (no marca el sync como parcial/offline).
- Tests del mobile: expo-sqlite y `fetch` están mockeados (se asertan llamadas SQL/HTTP, no resultados reales). Seguir ese patrón (ver `__tests__/db.test.ts`, `__tests__/sync.test.ts`).
- La suite del mobile sigue verde.

---

### Task 1: columna `talla_pushed` + helpers de DB

**Files:**
- Modify: `mobile/lib/db.ts` (schema + migración; `updateIssueTallas`; nuevos `readPendingTallaPush`, `markTallasPushed`)
- Test: `mobile/__tests__/db.test.ts`

**Interfaces:**
- Produces:
  - `readPendingTallaPush(db): Promise<{ id: string; talla: string; confidence: number }[]>`
  - `markTallasPushed(db, ids: string[]): Promise<void>`
  - `updateIssueTallas` ahora setea `talla_pushed=0`.

- [ ] **Step 1: Escribir tests (fallan)**

Agregar a `mobile/__tests__/db.test.ts` (el `db` es el mock de expo-sqlite; se asertan las llamadas):

```ts
import { readPendingTallaPush, markTallasPushed, updateIssueTallas } from '../lib/db';

describe('talla_pushed helpers', () => {
  test('updateIssueTallas marca talla_pushed=0 al escribir', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await updateIssueTallas(db, new Map([['X', { talla: 'M', confidence: 0.9 }]]));
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('talla_pushed=0'),
      ['M', 0.9, 'X'],
    );
  });

  test('readPendingTallaPush consulta pendientes (talla no nula, no pusheadas)', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    const rows = await readPendingTallaPush(db);
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.stringMatching(/talla IS NOT NULL[\s\S]*talla_pushed = 0/));
    expect(rows).toEqual([{ id: 'X', talla: 'M', confidence: 0.9 }]);
  });

  test('markTallasPushed setea talla_pushed=1 para los ids dados', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await markTallasPushed(db, ['A', 'B']);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('talla_pushed = 1'),
      ['A', 'B'],
    );
  });

  test('markTallasPushed no hace nada con lista vacía', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await markTallasPushed(db, []);
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr → fallan**

Run: `cd mobile && npx jest db.test.ts`
Expected: FAIL (funciones no existen / updateIssueTallas no incluye talla_pushed).

- [ ] **Step 3: Schema + migración en `getDb()`**

En `mobile/lib/db.ts`, en el `CREATE TABLE IF NOT EXISTS issues (...)`, agregar la columna al final:
```
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
      assignee_id TEXT, talla TEXT, talla_confidence REAL,
      created_at TEXT, updated_at TEXT, last_transition_at TEXT,
      talla_pushed INTEGER NOT NULL DEFAULT 0
    );
```
Después del `await db.execAsync(\`...\`)` que crea las tablas (dentro de `getDb`, antes del `return db`), agregar la migración idempotente:
```ts
const issueCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(issues)`);
if (!issueCols.some(c => c.name === 'talla_pushed')) {
  await db.execAsync(`ALTER TABLE issues ADD COLUMN talla_pushed INTEGER NOT NULL DEFAULT 0`);
}
```

- [ ] **Step 4: `updateIssueTallas` marca pendiente**

Cambiar el UPDATE:
```ts
await db.runAsync('UPDATE issues SET talla=?, talla_confidence=?, talla_pushed=0 WHERE id=?', [r.talla, r.confidence, id]);
```

- [ ] **Step 5: Nuevos helpers**

Agregar en `mobile/lib/db.ts`:
```ts
export async function readPendingTallaPush(
  db: SQLite.SQLiteDatabase,
): Promise<{ id: string; talla: string; confidence: number }[]> {
  return db.getAllAsync<{ id: string; talla: string; confidence: number }>(
    'SELECT id, talla, talla_confidence AS confidence FROM issues WHERE talla IS NOT NULL AND talla_pushed = 0',
  );
}

export async function markTallasPushed(db: SQLite.SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE issues SET talla_pushed = 1 WHERE id IN (${placeholders})`, ids);
}
```

- [ ] **Step 6: Correr → pasan**

Run: `cd mobile && npx jest db.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/db.test.ts
git commit -m "feat(mobile): columna talla_pushed + helpers de push pendiente"
```

---

### Task 2: `pushTallas` (api) + `pushPendingTallas` + wiring en `performSync`

**Files:**
- Modify: `mobile/lib/api.ts` (nuevo `pushTallas`)
- Modify: `mobile/lib/sync.ts` (nuevo `pushPendingTallas`; llamarlo en `performSync`)
- Test: `mobile/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `readPendingTallaPush`, `markTallasPushed` (Task 1); `getBaseUrl` (api.ts).
- Produces:
  - `pushTallas(tallas: { id: string; talla: string; confidence: number }[]): Promise<{ updated: number }>`
  - `pushPendingTallas(db): Promise<{ pushed: number; error?: string }>`

- [ ] **Step 1: Escribir tests (fallan)**

Agregar a `mobile/__tests__/sync.test.ts` (usa el mock de `fetch` y de expo-sqlite ya presentes):

```ts
import { pushPendingTallas } from '../lib/sync';
import { getDb } from '../lib/db';

describe('pushPendingTallas', () => {
  beforeEach(() => jest.clearAllMocks());

  test('empuja pendientes y las marca', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ updated: 1 }) });
    const res = await pushPendingTallas(db);
    expect(res).toEqual({ pushed: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tallas'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('talla_pushed = 1'), ['X']);
  });

  test('no-op cuando no hay pendientes', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([]);
    const res = await pushPendingTallas(db);
    expect(res).toEqual({ pushed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('devuelve error string si el POST falla', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    const res = await pushPendingTallas(db);
    expect(res.pushed).toBe(0);
    expect(res.error).toContain('500');
  });
});
```

- [ ] **Step 2: Correr → fallan**

Run: `cd mobile && npx jest sync.test.ts`
Expected: FAIL (`pushPendingTallas` no existe).

- [ ] **Step 3: `pushTallas` en `mobile/lib/api.ts`**

```ts
export async function pushTallas(
  tallas: { id: string; talla: string; confidence: number }[],
): Promise<{ updated: number }> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/tallas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tallas),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} /api/tallas`);
  return res.json() as Promise<{ updated: number }>;
}
```

- [ ] **Step 4: `pushPendingTallas` en `mobile/lib/sync.ts` + wiring**

Agregar los imports que falten (`readPendingTallaPush`, `markTallasPushed` de `./db`; `pushTallas` de `./api`) y la función:
```ts
export async function pushPendingTallas(
  db: SQLite.SQLiteDatabase,
): Promise<{ pushed: number; error?: string }> {
  try {
    const pending = await readPendingTallaPush(db);
    if (pending.length === 0) return { pushed: 0 };
    await pushTallas(pending);
    await markTallasPushed(db, pending.map(p => p.id));
    return { pushed: pending.length };
  } catch (err) {
    return { pushed: 0, error: String(err) };
  }
}
```
En `performSync`, después de `await writeSnapshots(db, bundle, syncedAt);`, agregar:
```ts
const push = await pushPendingTallas(db);
if (push.error) errors.push({ endpoint: '/api/tallas', message: push.error });
```
(No modificar el cálculo de `okCount`/`failCount`: el push es best-effort.)

- [ ] **Step 5: Correr → pasan**

Run: `cd mobile && npx jest sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Suite completa + typecheck**

Run: `cd mobile && npx jest`
Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` (ignorar el error pre-existente de `TabHeader`/`@react-navigation/bottom-tabs`, ajeno a este cambio).
Expected: jest todo verde; sin errores nuevos de tsc.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/api.ts mobile/lib/sync.ts mobile/__tests__/sync.test.ts
git commit -m "feat(mobile): push de tallas pendientes en backend sync (POST /api/tallas)"
```

## Verification

```bash
cd mobile && npx jest        # todo verde (previos + nuevos)
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit   # solo el error pre-existente de TabHeader
```

## Archivos críticos

- `mobile/lib/db.ts` — columna talla_pushed + migración + helpers
- `mobile/lib/api.ts` — pushTallas
- `mobile/lib/sync.ts` — pushPendingTallas + wiring en performSync
- `mobile/__tests__/db.test.ts`, `mobile/__tests__/sync.test.ts` — tests (mock de sqlite/fetch)
