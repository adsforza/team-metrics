# SP-A: Server endpoints (`POST /api/tallas` + `GET /api/raw`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al server dos endpoints aditivos: `POST /api/tallas` (recibe clasificaciones del celu y llena solo huecos) y `GET /api/raw` (exporta crudo — issues/transitions/members — con delta opcional por `since`), prerequisito de SP-B y SP-C.

**Architecture:** Cada endpoint es un `Router` de Express en su propio archivo (`server/src/routes/tallas.ts`, `server/src/routes/raw.ts`), montado en `server/src/index.ts`. Leen/escriben la SQLite existente vía `getDb()`. El filtro `since` de `/api/raw` se hace en **JS** (`Date.parse`), no en SQL, porque los timestamps de Jira vienen con offset `-0300` que `julianday()`/comparación lexical de SQLite no maneja (mismo motivo por el que `issues.ts` calcula `ct_days` en JS).

**Tech Stack:** Node 20 + TypeScript + Express + better-sqlite3; tests con Vitest + supertest.

## Global Constraints

- Endpoints **aditivos**: los ~75 tests del server siguen verdes sin cambios.
- `express.json()` ya está montado en `index.ts` (bodies JSON disponibles).
- Set de tallas válidas: `'S' | 'M' | 'L' | 'XL'` (coincide con el CHECK de la tabla `issues`).
- `POST /api/tallas` **fill-only**: nunca pisa una talla existente (`WHERE id=? AND talla IS NULL`).
- Errores propagados con `next(err)` (hay un error handler global que responde 500 `{error}`).
- Columnas reales:
  - `issues(id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at)`
  - `transitions(id, issue_id, from_status, to_status, transitioned_at)`
  - `team_members(id, display_name, email, avatar_url)`
  - `sync_log(id, started_at, finished_at, synced_count, classified_count, error)`

---

### Task 1: `POST /api/tallas`

**Files:**
- Create: `server/src/routes/tallas.ts`
- Modify: `server/src/index.ts` (import + `app.use('/api/tallas', tallasRouter)`)
- Test: `server/src/routes/routes.test.ts` (agregar bloque describe)

**Interfaces:**
- Consumes: `getDb()` de `../db/index`.
- Produces: endpoint `POST /api/tallas`
  - Request body: `Array<{ id: string; talla: 'S'|'M'|'L'|'XL'; confidence: number }>`
  - Response 200: `{ updated: number }`
  - Response 400: `{ error: string }` si el body no es un array.

- [ ] **Step 1: Write the failing tests**

En `server/src/routes/routes.test.ts`, agregar al final (usa el `mockDb` y `app` ya importados; siembra ids propios `TAL-*` para aislar):

```ts
describe('POST /api/tallas', () => {
  beforeAll(() => {
    // TAL-1 sin talla (debe llenarse); TAL-2 ya clasificado (no debe pisarse)
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-1','a','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-2','b','','Done','u1','L',0.7,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
  });

  it('llena solo los huecos y no pisa tallas existentes', async () => {
    const res = await request(app).post('/api/tallas').send([
      { id: 'TAL-1', talla: 'S', confidence: 0.9 },
      { id: 'TAL-2', talla: 'M', confidence: 0.9 },
      { id: 'NOPE', talla: 'M', confidence: 0.9 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    const t1 = mockDb.prepare(`SELECT talla FROM issues WHERE id='TAL-1'`).get() as any;
    const t2 = mockDb.prepare(`SELECT talla FROM issues WHERE id='TAL-2'`).get() as any;
    expect(t1.talla).toBe('S');
    expect(t2.talla).toBe('L'); // intacto
  });

  it('ignora items con talla inválida', async () => {
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-3','c','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
    const res = await request(app).post('/api/tallas').send([{ id: 'TAL-3', talla: 'XXL', confidence: 0.9 }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it('body vacío devuelve updated 0', async () => {
    const res = await request(app).post('/api/tallas').send([]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it('body no-array devuelve 400', async () => {
    const res = await request(app).post('/api/tallas').send({ nope: true });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL (404 en el POST — ruta no existe todavía).

- [ ] **Step 3: Implement `server/src/routes/tallas.ts`**

```ts
import { Router } from 'express';
import { getDb } from '../db/index';

const router = Router();
const VALID_TALLAS = new Set(['S', 'M', 'L', 'XL']);

router.post('/', (req, res, next) => {
  try {
    const body = req.body;
    if (!Array.isArray(body)) {
      res.status(400).json({ error: 'body must be an array of { id, talla, confidence }' });
      return;
    }
    const db = getDb();
    const stmt = db.prepare(
      `UPDATE issues SET talla = ?, talla_confidence = ? WHERE id = ? AND talla IS NULL`,
    );
    const apply = db.transaction((items: any[]) => {
      let updated = 0;
      for (const it of items) {
        if (!it || typeof it.id !== 'string' || !VALID_TALLAS.has(it.talla)) continue;
        const conf = typeof it.confidence === 'number' ? it.confidence : null;
        const info = stmt.run(it.talla, conf, it.id);
        updated += info.changes;
      }
      return updated;
    });
    const updated = apply(body);
    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Register the router in `server/src/index.ts`**

Agregar el import junto a los otros routers:
```ts
import tallasRouter from './routes/tallas';
```
Y el mount junto a los otros `app.use`:
```ts
app.use('/api/tallas', tallasRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: PASS (todos, incluidos los 4 nuevos).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/tallas.ts server/src/index.ts server/src/routes/routes.test.ts
git commit -m "feat(server): POST /api/tallas (fill-only classifications ingest)"
```

---

### Task 2: `GET /api/raw`

**Files:**
- Create: `server/src/routes/raw.ts`
- Modify: `server/src/index.ts` (import + `app.use('/api/raw', rawRouter)`)
- Test: `server/src/routes/routes.test.ts` (agregar bloque describe)

**Interfaces:**
- Consumes: `getDb()` de `../db/index`.
- Produces: endpoint `GET /api/raw?since=<iso?>`
  - Response 200:
    ```ts
    {
      issues: Array<{ id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, last_transition_at }>;
      transitions: Array<{ issue_id, from_status, to_status, transitioned_at }>;
      members: Array<{ id, display_name, email, avatar_url }>;
      serverSyncedAt: string | null;
    }
    ```
  - `since` (opcional): filtra `issues` por `Date.parse(updated_at) >= Date.parse(since)` (en JS). `transitions` = solo las de los issues devueltos.

- [ ] **Step 1: Write the failing tests**

En `server/src/routes/routes.test.ts`, agregar al final. Sembrar datos con dos `updated_at` distintos y una transición, más una fila en `sync_log`:

```ts
describe('GET /api/raw', () => {
  beforeAll(() => {
    mockDb.prepare(`INSERT INTO issues VALUES ('RAW-OLD','old','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-01-10T00:00:00Z','2026-01-10T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO issues VALUES ('RAW-NEW','new','','In Progress','u1',NULL,NULL,'2026-06-01T00:00:00Z','2026-06-20T00:00:00Z','2026-06-20T00:00:00Z','2026-06-20T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('RAW-NEW','To Do','In Progress','2026-06-05T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO sync_log (started_at,finished_at,synced_count,classified_count,error) VALUES ('2026-06-21T00:00:00Z','2026-06-21T00:05:00Z',10,5,NULL)`).run();
  });

  it('sin since devuelve issues, transitions, members y serverSyncedAt', async () => {
    const res = await request(app).get('/api/raw');
    expect(res.status).toBe(200);
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('RAW-OLD');
    expect(ids).toContain('RAW-NEW');
    expect(Array.isArray(res.body.transitions)).toBe(true);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.serverSyncedAt).toBe('2026-06-21T00:05:00Z');
  });

  it('con since filtra por updated_at (en JS, tolera offset)', async () => {
    const res = await request(app).get('/api/raw?since=2026-03-01T00:00:00Z');
    expect(res.status).toBe(200);
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('RAW-NEW');
    expect(ids).not.toContain('RAW-OLD');
    // transitions solo de los issues devueltos
    for (const t of res.body.transitions) {
      expect(ids).toContain(t.issue_id);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL (404 en `/api/raw`).

- [ ] **Step 3: Implement `server/src/routes/raw.ts`**

```ts
import { Router } from 'express';
import { getDb } from '../db/index';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const since = req.query.since as string | undefined;

    const allIssues = db.prepare(
      `SELECT id, title, description, status, assignee_id, talla, talla_confidence,
              created_at, updated_at, last_transition_at
       FROM issues`,
    ).all() as any[];

    // Filtro por since en JS: los updated_at de Jira traen offset (-0300) que
    // julianday()/comparación lexical de SQLite no maneja; Date.parse sí.
    const sinceMs = since ? Date.parse(since) : null;
    const issues = sinceMs != null && !isNaN(sinceMs)
      ? allIssues.filter(i => Date.parse(i.updated_at) >= sinceMs)
      : allIssues;

    const ids = new Set(issues.map(i => i.id));
    const allTransitions = db.prepare(
      `SELECT issue_id, from_status, to_status, transitioned_at FROM transitions`,
    ).all() as any[];
    const transitions = allTransitions.filter(t => ids.has(t.issue_id));

    const members = db.prepare(
      `SELECT id, display_name, email, avatar_url FROM team_members`,
    ).all() as any[];

    const lastSync = db.prepare(
      `SELECT finished_at FROM sync_log WHERE error IS NULL AND finished_at IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    ).get() as { finished_at: string } | undefined;

    res.json({
      issues,
      transitions,
      members,
      serverSyncedAt: lastSync?.finished_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Register the router in `server/src/index.ts`**

```ts
import rawRouter from './routes/raw';
```
```ts
app.use('/api/raw', rawRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: PASS (los 2 nuevos + todos los previos).

- [ ] **Step 6: Full server suite + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: todo verde; sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/raw.ts server/src/index.ts server/src/routes/routes.test.ts
git commit -m "feat(server): GET /api/raw (crudo issues/transitions/members con delta since)"
```

## Verification

```bash
cd server && npx vitest run        # todos verdes (previos + 6 nuevos)
cd server && npx tsc --noEmit      # typecheck server
```

Smoke manual (opcional, server levantado):
```bash
curl -s -X POST http://localhost:3001/api/tallas -H 'content-type: application/json' -d '[]'      # {"updated":0}
curl -s "http://localhost:3001/api/raw" | head -c 200                                              # {"issues":[...
curl -s "http://localhost:3001/api/raw?since=2026-07-01T00:00:00Z" | python3 -c "import sys,json;d=json.load(sys.stdin);print('issues',len(d['issues']),'transitions',len(d['transitions']),'serverSyncedAt',d['serverSyncedAt'])"
```

## Archivos críticos

- `server/src/routes/tallas.ts` — nuevo, POST fill-only
- `server/src/routes/raw.ts` — nuevo, GET crudo + delta
- `server/src/index.ts` — registro de ambos routers
- `server/src/routes/routes.test.ts` — patrón de test (mockDb `:memory:` + supertest)
