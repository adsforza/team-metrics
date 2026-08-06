# SP-A.1: `talla_updated_at` para propagación de tallas por delta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que las clasificaciones de talla (vía `POST /api/tallas` y el reclassify del server) se propaguen por el delta de `GET /api/raw?since=`, sin pisar `updated_at` (que refleja el "updated" de Jira). Se hace con una columna nueva `talla_updated_at` y un delta que usa `max(updated_at, talla_updated_at)`.

**Architecture:** Nueva columna `talla_updated_at TEXT` en `issues` (server). Se setea `= now` en cada escritura de talla. `GET /api/raw` filtra por el efectivo `max(updated_at, talla_updated_at)`. El upsert de `services/sync.ts` NO clasifica (solo preserva talla) → no toca `talla_updated_at` (se conserva en el ON CONFLICT porque no está en el SET).

**Tech Stack:** Node 20 + TS + Express + better-sqlite3; Vitest + supertest.

## Global Constraints

- Cambio **server-only**, aditivo. El mobile NO necesita la columna (el filtro del delta es server-side).
- No hay sistema de migraciones: la columna se agrega en el `CREATE TABLE` (DB nuevas) **y** con un `ALTER TABLE` idempotente guardado por `PRAGMA table_info` (DB existentes).
- `talla_updated_at` se setea `= new Date().toISOString()` en TODA escritura de una talla nueva: `POST /api/tallas` y el reclassify de `routes/sync.ts`. El upsert de `services/sync.ts` no la toca.
- `GET /api/raw`: el delta usa el tiempo efectivo `max(Date.parse(updated_at), Date.parse(talla_updated_at))` (ignorando NaN). `talla_updated_at` **no** se expone en la respuesta (se mantiene el shape `{ issues, transitions, members, serverSyncedAt }` con el mismo whitelist de campos por issue de SP-A).
- Los tests existentes siguen verdes. Agregar la columna rompe los `INSERT INTO issues VALUES(...)` **posicionales** del test — hay que actualizarlos (ver Task, Step 1b).

---

### Task 1: columna `talla_updated_at` + escrituras + delta efectivo

**Files:**
- Modify: `server/src/db/schema.ts` (columna en CREATE + ALTER idempotente)
- Modify: `server/src/routes/tallas.ts` (setear talla_updated_at)
- Modify: `server/src/routes/sync.ts` (setear talla_updated_at en reclassify)
- Modify: `server/src/routes/raw.ts` (delta con max; no exponer la columna)
- Test: `server/src/routes/routes.test.ts`

**Interfaces:**
- Consumes: `applySchema(db)`, `getDb()`, endpoints de SP-A (`POST /api/tallas`, `GET /api/raw`).
- Produces: columna `issues.talla_updated_at`; contrato de delta actualizado (tallas propagan).

- [ ] **Step 1a: Escribir los tests nuevos (fallan)**

Agregar al final de `server/src/routes/routes.test.ts` (usa columnas nombradas para no depender del orden posicional):

```ts
describe('talla_updated_at (propagación de tallas por delta)', () => {
  it('POST /api/tallas setea talla_updated_at al llenar una talla', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at)
      VALUES ('TUA-1','x','','Done','u1',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`).run();
    const res = await request(app).post('/api/tallas').send([{ id: 'TUA-1', talla: 'M', confidence: 0.9 }]);
    expect(res.body).toEqual({ updated: 1 });
    const row = mockDb.prepare(`SELECT talla_updated_at FROM issues WHERE id='TUA-1'`).get() as any;
    expect(typeof row.talla_updated_at).toBe('string');
    expect(row.talla_updated_at.length).toBeGreaterThan(0);
  });

  it('GET /api/raw?since incluye un issue con talla_updated_at reciente aunque updated_at sea viejo, y no expone la columna', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at,talla_updated_at)
      VALUES ('TUA-2','y','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-07-01T00:00:00Z')`).run();
    const res = await request(app).get('/api/raw?since=2026-06-01T00:00:00Z');
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('TUA-2');
    const tua2 = res.body.issues.find((i: any) => i.id === 'TUA-2');
    expect(tua2).not.toHaveProperty('talla_updated_at');
  });

  it('GET /api/raw?since excluye issue viejo sin talla_updated_at', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at)
      VALUES ('TUA-3','z','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`).run();
    const res = await request(app).get('/api/raw?since=2026-06-01T00:00:00Z');
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).not.toContain('TUA-3');
  });
});
```

- [ ] **Step 1b: Arreglar los INSERT posicionales existentes**

Agregar la columna al final de `issues` rompe los `INSERT INTO issues VALUES(...)` **posicionales** (esperan 11 valores; pasan a 12). Buscar en `server/src/routes/routes.test.ts` cada `INSERT INTO issues VALUES (` y agregarle **un valor final** (la talla_updated_at). Para las filas ya clasificadas podés poner un ISO; para las que están en NULL, poné `NULL`. Ejemplos de conversión (aplicar a TODAS las que existan: OPS-1, TAL-1, TAL-2, TAL-3, RAW-OLD, RAW-NEW):

```
-- antes:
INSERT INTO issues VALUES ('OPS-1','Fix login','desc','In Progress','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-01T00:00:00Z')
-- después (append un valor final):
INSERT INTO issues VALUES ('OPS-1','Fix login','desc','In Progress','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-01T00:00:00Z',NULL)
```

(Alternativa válida: convertir cada uno a `INSERT INTO issues (col,col,...) VALUES (...)` con columnas nombradas. Lo que prefieras; lo importante es que el número de valores case con el schema.)

- [ ] **Step 2: Correr los tests → deben fallar**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL (columna `talla_updated_at` no existe todavía → errores de SQL / aserciones).

- [ ] **Step 3: Schema — agregar la columna (CREATE + ALTER idempotente)**

En `server/src/db/schema.ts`:
1. Agregar `talla_updated_at TEXT` como última columna del `CREATE TABLE IF NOT EXISTS issues (...)`.
2. Después del bloque `db.exec(\`...CREATE TABLE...\`)` (dentro de `applySchema`), agregar la migración idempotente para DBs existentes:

```ts
const issueCols = db.prepare(`PRAGMA table_info(issues)`).all() as { name: string }[];
if (!issueCols.some(c => c.name === 'talla_updated_at')) {
  db.exec(`ALTER TABLE issues ADD COLUMN talla_updated_at TEXT`);
}
```

- [ ] **Step 4: Escrituras de talla setean `talla_updated_at`**

`server/src/routes/tallas.ts` — cambiar el UPDATE y su `.run`:
```ts
const stmt = db.prepare(
  `UPDATE issues SET talla = ?, talla_confidence = ?, talla_updated_at = ? WHERE id = ? AND talla IS NULL`,
);
// dentro del loop:
const now = new Date().toISOString();
const info = stmt.run(it.talla, conf, now, it.id);
```

`server/src/routes/sync.ts` — en el reclassify (donde hoy hace `UPDATE issues SET talla = ?, talla_confidence = ? WHERE id = ?`):
```ts
db.prepare(`UPDATE issues SET talla = ?, talla_confidence = ?, talla_updated_at = ? WHERE id = ?`)
  .run(r.talla, r.confidence, new Date().toISOString(), issue.id);
```

(No tocar `services/sync.ts`: su upsert preserva la talla y no incluye `talla_updated_at` en el SET del ON CONFLICT, así que la columna se conserva sola.)

- [ ] **Step 5: `GET /api/raw` — delta efectivo + no exponer la columna**

En `server/src/routes/raw.ts`:
1. Agregar `talla_updated_at` al SELECT de issues.
2. El filtro `since` usa el efectivo:
```ts
const sinceMs = since ? Date.parse(since) : null;
const eff = (i: any) => {
  const u = Date.parse(i.updated_at);
  const t = i.talla_updated_at ? Date.parse(i.talla_updated_at) : NaN;
  return Math.max(isNaN(u) ? -Infinity : u, isNaN(t) ? -Infinity : t);
};
const filtered = sinceMs != null && !isNaN(sinceMs)
  ? allIssues.filter(i => eff(i) >= sinceMs)
  : allIssues;
```
3. Construir `ids` desde `filtered`, filtrar transitions con eso, y **quitar** `talla_updated_at` de la respuesta:
```ts
const ids = new Set(filtered.map(i => i.id));
const issues = filtered.map(({ talla_updated_at, ...rest }) => rest);
// ...transitions filtradas por ids..., members, serverSyncedAt igual que antes
res.json({ issues, transitions, members, serverSyncedAt: lastSync?.finished_at ?? null });
```

- [ ] **Step 6: Correr los tests → deben pasar**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: PASS (todos, incluidos los 3 nuevos y los previos con los INSERT arreglados).

- [ ] **Step 7: Full suite + typecheck**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: todo verde; sin errores de tipos.

- [ ] **Step 8: Commit**

```bash
git add server/src/db/schema.ts server/src/routes/tallas.ts server/src/routes/sync.ts server/src/routes/raw.ts server/src/routes/routes.test.ts
git commit -m "feat(server): talla_updated_at para propagar tallas por delta /api/raw"
```

## Verification

```bash
cd server && npx vitest run        # todos verdes (previos ajustados + 3 nuevos)
cd server && npx tsc --noEmit
```

## Archivos críticos

- `server/src/db/schema.ts` — columna + ALTER idempotente
- `server/src/routes/tallas.ts` / `server/src/routes/sync.ts` — setean talla_updated_at
- `server/src/routes/raw.ts` — delta con max(updated_at, talla_updated_at), sin exponer la columna
- `server/src/routes/routes.test.ts` — tests nuevos + fix de INSERT posicionales
