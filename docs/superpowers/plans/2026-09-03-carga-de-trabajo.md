# Solapa "Carga de trabajo" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una solapa al mobile que muestre, por squad y por equipo solicitante, cuántos pedidos entraron en un rango de fechas y cuántos siguen pendientes hoy, con drill-down a los tickets de cada solicitante.

**Architecture:** La lógica de agregación vive como funciones puras en `shared/core/workload.ts`, testeadas sin red ni DB. El server las expone en `GET /api/workload`; el mobile las consume vía snapshot en backend mode y las ejecuta localmente en direct mode a través de `computeBundle`. Dos dimensiones nuevas se persisten en el crudo: `requester` (campo Jira `customfield_13510`) y `boards` (procedencia, que hoy se pierde en el `.flat()` de `sync.ts`).

**Tech Stack:** TypeScript, better-sqlite3 (server), expo-sqlite (mobile), Express, React Native + expo-router, Vitest (server/core), Jest (mobile).

**Spec:** `docs/superpowers/specs/2026-09-03-carga-de-trabajo-design.md`

## Global Constraints

- **No reprocesar tallas ya clasificadas.** Ningún cambio de este plan puede hacer que un issue con `talla` no nula la pierda o se reclasifique. `sync.ts:38` la preserva y `sync.test.ts:55` lo cubre; ese test debe seguir pasando sin modificarse.
- **El sync no llama a Gemini.** La clasificación está desacoplada en `POST /api/sync/reclassify`. El backfill no debe gastar cuota.
- **Migraciones aditivas.** Solo `ALTER TABLE ADD COLUMN` con guarda `PRAGMA table_info`, como `talla_updated_at` (`server/src/db/schema.ts:57`) y `talla_pushed` (`mobile/lib/db.ts`). Nunca `DROP` ni recrear tablas.
- **Campo Jira del solicitante:** `customfield_13510`. Campo de prioridad: `priority`.
- **Boards:** `9534` = Black Team Infra, `9536` = Blue Team Infra. Nunca hardcodear esos nombres en código; se leen de `board_sync.name`.
- **Umbral de antigüedad:** `AGING_THRESHOLD_DAYS` (default 7), la misma env var que ya usa `server/src/services/metrics.ts:20`.
- **Un issue en dos boards cuenta en ambos squads.** `totals.compartidos` expone cuántos son.

---

### Task 1: Core — parsear `requester`, `priority` y `boards` desde Jira

**Files:**
- Modify: `shared/core/jira.ts`
- Test: `shared/core/jira.test.ts`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: `JiraIssueRaw` con tres campos nuevos (`requester: string | null`, `priority: string | null`, `boards: number[]`), y `mergeIssuesByBoard(issueArrays: JiraIssueRaw[][]): JiraIssueRaw[]`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `shared/core/jira.test.ts`:

```ts
import { parseJiraIssue, mergeIssuesByBoard } from './jira';

const rawIssue = (over: any = {}) => ({
  key: 'DPP-1',
  fields: {
    summary: 'Titulo', description: null, status: { name: 'Backlog' }, assignee: null,
    created: '2026-01-01T00:00:00.000-0300', updated: '2026-01-02T00:00:00.000-0300',
    priority: { name: 'High (P1)' },
    customfield_13510: [{ value: 'Tony Stack' }],
    ...over,
  },
  changelog: { histories: [] },
});

describe('parseJiraIssue — requester/priority/boards', () => {
  it('extrae requester del customfield_13510 y la prioridad', () => {
    const r = parseJiraIssue(rawIssue());
    expect(r.requester).toBe('Tony Stack');
    expect(r.priority).toBe('High (P1)');
  });

  it('deja requester y priority en null cuando Jira no los trae', () => {
    const r = parseJiraIssue(rawIssue({ customfield_13510: null, priority: null }));
    expect(r.requester).toBeNull();
    expect(r.priority).toBeNull();
  });

  it('acepta el customfield como objeto, no solo como array', () => {
    const r = parseJiraIssue(rawIssue({ customfield_13510: { value: 'Groot' } }));
    expect(r.requester).toBe('Groot');
  });

  it('devuelve boards vacio: la procedencia la agrega fetchBoardIssues', () => {
    expect(parseJiraIssue(rawIssue()).boards).toEqual([]);
  });
});

describe('mergeIssuesByBoard', () => {
  const mk = (id: string, boards: number[]) => ({ ...parseJiraIssue(rawIssue()), id, boards } as any);

  it('dedupea por id y hace la union de boards', () => {
    const out = mergeIssuesByBoard([[mk('DPP-1', [9534])], [mk('DPP-1', [9536]), mk('DPP-2', [9536])]]);
    expect(out).toHaveLength(2);
    expect(out.find(i => i.id === 'DPP-1')!.boards.sort()).toEqual([9534, 9536]);
    expect(out.find(i => i.id === 'DPP-2')!.boards).toEqual([9536]);
  });

  it('no duplica un board repetido', () => {
    const out = mergeIssuesByBoard([[mk('DPP-1', [9534])], [mk('DPP-1', [9534])]]);
    expect(out[0].boards).toEqual([9534]);
  });

  it('con un solo array devuelve lo mismo', () => {
    expect(mergeIssuesByBoard([[mk('DPP-9', [9534])]])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd shared/core && npx vitest run jira.test.ts`
Expected: FAIL — `mergeIssuesByBoard is not a function` y `requester` undefined.

- [ ] **Step 3: Implementar**

En `shared/core/jira.ts`, agregar los tres campos a la interfaz:

```ts
export interface JiraIssueRaw {
  id: string; title: string; description: string; status: string;
  assignee: { id: string; display_name: string; email: string; avatar_url: string | null } | null;
  requester: string | null;
  priority: string | null;
  boards: number[];
  created_at: string; updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

const REQUESTER_FIELD = 'customfield_13510';

// Los custom fields de tipo select llegan como objeto {value} o como array de objetos.
function optionValue(v: any): string | null {
  if (v == null) return null;
  const first = Array.isArray(v) ? v[0] : v;
  const s = first?.value ?? first?.name ?? null;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}
```

Dentro de `parseJiraIssue`, en el objeto de retorno agregar:

```ts
    requester: optionValue(raw.fields[REQUESTER_FIELD]),
    priority: raw.fields.priority?.name ?? null,
    boards: [],
```

Agregar `mergeIssuesByBoard` al final del archivo:

```ts
// Reemplaza al .flat() de sync.ts: un issue presente en varios boards aparece una
// sola vez, con la union de sus boards, en vez de que el segundo upsert pise al primero.
export function mergeIssuesByBoard(issueArrays: JiraIssueRaw[][]): JiraIssueRaw[] {
  const byId = new Map<string, JiraIssueRaw>();
  for (const arr of issueArrays) {
    for (const issue of arr) {
      const prev = byId.get(issue.id);
      if (!prev) { byId.set(issue.id, { ...issue, boards: [...issue.boards] }); continue; }
      for (const b of issue.boards) if (!prev.boards.includes(b)) prev.boards.push(b);
    }
  }
  return [...byId.values()];
}
```

En `fetchBoardIssues`, sumar el campo al request y etiquetar la procedencia:

```ts
      params: { jql, startAt, maxResults, expand: 'changelog',
        fields: `summary,description,status,assignee,created,updated,priority,${REQUESTER_FIELD}` },
```

```ts
    for (const issue of issues) results.push({ ...parseJiraIssue(issue), boards: [cfg.boardId] });
```

- [ ] **Step 4: Correr los tests**

Run: `cd shared/core && npx vitest run jira.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/core/jira.ts shared/core/jira.test.ts
git commit -m "feat(core): parsear requester, priority y procedencia de board en los issues de Jira"
```

---

### Task 2: Core — `computeWorkload`

**Files:**
- Create: `shared/core/workload.ts`
- Create: `shared/core/workload.test.ts`
- Modify: `shared/core/types.ts`

**Interfaces:**
- Consumes: `categorize()` de `shared/core/statusCategories.ts`, `CoreIssueWithTitle` de `shared/core/types.ts`.
- Produces: `CoreIssueWorkload`, `WorkloadRequester`, `WorkloadSquad`, `WorkloadResult`, `computeWorkload(issues, boards, params)`.

- [ ] **Step 1: Escribir el test que falla**

Crear `shared/core/workload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWorkload } from './workload';
import type { CoreIssueWorkload } from './types';

const iss = (over: Partial<CoreIssueWorkload>): CoreIssueWorkload => ({
  id: 'X', title: 'T', status: 'Backlog', assignee_id: null, talla: null,
  created_at: '2026-06-15T00:00:00.000Z', last_transition_at: null,
  requester: 'Groot', priority: null, boards: [9534], ...over,
});

const BOARDS = [{ id: 9534, name: 'Black Team Infra' }, { id: 9536, name: 'Blue Team Infra' }];
const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('computeWorkload', () => {
  it('cuenta como pedido lo creado dentro del rango, incluido lo cerrado', () => {
    const r = computeWorkload([
      iss({ id: 'A', status: 'Finalizada' }),
      iss({ id: 'B', status: 'Backlog' }),
    ], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(2);
  });

  it('excluye del rango lo creado fuera de el', () => {
    const r = computeWorkload([iss({ id: 'A', created_at: '2026-01-01T00:00:00.000Z' })], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(0);
  });

  it('cuenta pendientes lo abierto hoy, sin importar el rango', () => {
    const r = computeWorkload([
      iss({ id: 'A', status: 'Backlog', created_at: '2020-01-01T00:00:00.000Z' }),
      iss({ id: 'B', status: 'Finalizada' }),
      iss({ id: 'C', status: 'Cancelado' }),
    ], BOARDS, RANGE);
    const black = r.squads.find(s => s.board_id === 9534)!;
    expect(black.pendientes).toBe(1);
    expect(black.pedidos).toBe(2);   // B y C entraron en el rango; A no
  });

  it('un issue en dos boards cuenta en ambos squads y aparece en compartidos', () => {
    const r = computeWorkload([iss({ id: 'A', boards: [9534, 9536] })], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(1);
    expect(r.squads.find(s => s.board_id === 9536)!.pedidos).toBe(1);
    expect(r.totals.pedidos).toBe(1);          // el total NO lo duplica
    expect(r.totals.compartidos).toBe(1);
  });

  it('agrupa el requester nulo en un bucket propio', () => {
    const r = computeWorkload([
      iss({ id: 'A', requester: null }),
      iss({ id: 'B', requester: null }),
      iss({ id: 'C', requester: 'Groot' }),
    ], BOARDS, RANGE);
    const rs = r.squads.find(s => s.board_id === 9534)!.requesters;
    expect(rs.find(x => x.requester === null)!.pedidos).toBe(2);
    expect(rs.find(x => x.requester === 'Groot')!.pedidos).toBe(1);
  });

  it('ordena los solicitantes por pedidos desc, desempatando por nombre', () => {
    const r = computeWorkload([
      iss({ id: 'A', requester: 'Zeta' }), iss({ id: 'B', requester: 'Zeta' }),
      iss({ id: 'C', requester: 'Alfa' }), iss({ id: 'D', requester: 'Beta' }),
    ], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.requesters.map(x => x.requester))
      .toEqual(['Zeta', 'Alfa', 'Beta']);
  });

  it('devuelve todos los boards conocidos aunque no tengan issues', () => {
    const r = computeWorkload([], BOARDS, RANGE);
    expect(r.squads.map(s => s.name)).toEqual(['Black Team Infra', 'Blue Team Infra']);
    expect(r.totals).toEqual({ pedidos: 0, pendientes: 0, compartidos: 0 });
  });

  it('ignora issues cuyo board no esta en la lista', () => {
    const r = computeWorkload([iss({ id: 'A', boards: [999] })], BOARDS, RANGE);
    expect(r.totals.pedidos).toBe(0);
  });

  it('sin rango cuenta todos los pedidos', () => {
    const r = computeWorkload([iss({ id: 'A', created_at: '2001-01-01T00:00:00.000Z' })], BOARDS, {});
    expect(r.totals.pedidos).toBe(1);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd shared/core && npx vitest run workload.test.ts`
Expected: FAIL — no existe `./workload`.

- [ ] **Step 3: Implementar**

En `shared/core/types.ts`, después de `CoreIssueWithTitle`:

```ts
// CoreIssueWithTitle + las dimensiones de carga de trabajo. Mismo criterio que
// CoreIssueWithTitle: no obligar a todo productor de CoreIssue a cargar campos que no usa.
export interface CoreIssueWorkload extends CoreIssueWithTitle {
  requester: string | null;
  priority: string | null;
  boards: number[];
}
```

Crear `shared/core/workload.ts`:

```ts
import { categorize } from './statusCategories';
import type { CoreIssueWorkload } from './types';

export interface WorkloadRequester { requester: string | null; pedidos: number; pendientes: number; }
export interface WorkloadSquad {
  board_id: number; name: string;
  pedidos: number; pendientes: number;
  requesters: WorkloadRequester[];
}
export interface WorkloadResult {
  squads: WorkloadSquad[];
  totals: { pedidos: number; pendientes: number; compartidos: number };
}

// Pendiente = todo lo que no esta terminado ni cancelado. Deliberadamente NO se
// filtra por rango: un ticket abierto hace ocho meses sigue pesando hoy.
export function isPendiente(status: string): boolean {
  const c = categorize(status);
  return c !== 'done' && c !== 'cancelled';
}

function enRango(created_at: string, from?: string, to?: string): boolean {
  const d = created_at.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function computeWorkload(
  issues: CoreIssueWorkload[],
  boards: { id: number; name: string }[],
  params: { from?: string; to?: string },
): WorkloadResult {
  const known = new Set(boards.map(b => b.id));
  const acc = new Map<number, Map<string | null, WorkloadRequester>>();
  for (const b of boards) acc.set(b.id, new Map());

  let totalPedidos = 0, totalPendientes = 0, compartidos = 0;

  for (const issue of issues) {
    const mine = issue.boards.filter(b => known.has(b));
    if (mine.length === 0) continue;
    if (mine.length > 1) compartidos++;

    const esPedido = enRango(issue.created_at, params.from, params.to);
    const esPend = isPendiente(issue.status);
    if (!esPedido && !esPend) continue;

    if (esPedido) totalPedidos++;
    if (esPend) totalPendientes++;

    for (const boardId of mine) {
      const bucket = acc.get(boardId)!;
      // Map admite null como clave, asi que el bucket "sin dato" no necesita
      // un centinela de string que podria colisionar con un equipo real.
      let row = bucket.get(issue.requester);
      if (!row) {
        row = { requester: issue.requester, pedidos: 0, pendientes: 0 };
        bucket.set(issue.requester, row);
      }
      if (esPedido) row.pedidos++;
      if (esPend) row.pendientes++;
    }
  }

  const squads: WorkloadSquad[] = boards.map(b => {
    const rows = [...acc.get(b.id)!.values()].sort((x, y) =>
      y.pedidos - x.pedidos || (x.requester ?? '').localeCompare(y.requester ?? ''));
    return {
      board_id: b.id, name: b.name,
      pedidos: rows.reduce((s, r) => s + r.pedidos, 0),
      pendientes: rows.reduce((s, r) => s + r.pendientes, 0),
      requesters: rows,
    };
  });

  return { squads, totals: { pedidos: totalPedidos, pendientes: totalPendientes, compartidos } };
}
```

- [ ] **Step 4: Correr el test**

Run: `cd shared/core && npx vitest run workload.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/core/workload.ts shared/core/workload.test.ts shared/core/types.ts
git commit -m "feat(core): computeWorkload — pedidos por rango y pendientes por squad/solicitante"
```

---

### Task 3: Core — `computeRequesterDetail` (drill-down)

**Files:**
- Modify: `shared/core/workload.ts`
- Modify: `shared/core/workload.test.ts`

**Interfaces:**
- Consumes: `isPendiente()` y `CoreIssueWorkload` de la Task 2.
- Produces: `WorkloadIssue`, `RequesterDetail`, `computeRequesterDetail(issues, params)`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `shared/core/workload.test.ts`:

```ts
import { computeRequesterDetail } from './workload';

const NOW = new Date('2026-06-30T00:00:00.000Z');
const dias = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

const P = { board_id: 9534, requester: 'Groot', scope: 'pendientes' as const,
            agingThresholdDays: 7, now: NOW };

describe('computeRequesterDetail', () => {
  it('filtra por board y solicitante, y ordena del mas viejo al mas nuevo', () => {
    const r = computeRequesterDetail([
      iss({ id: 'NUEVO', created_at: dias(3) }),
      iss({ id: 'VIEJO', created_at: dias(90) }),
      iss({ id: 'OTRO', requester: 'Snake', created_at: dias(50) }),
      iss({ id: 'OTROBOARD', boards: [9536], created_at: dias(50) }),
    ], P);
    expect(r.issues.map(i => i.id)).toEqual(['VIEJO', 'NUEVO']);
    expect(r.issues[0].edad_dias).toBe(90);
  });

  it('scope pendientes excluye lo cerrado; scope todos lo incluye segun el rango', () => {
    const data = [iss({ id: 'A', status: 'Backlog', created_at: dias(5) }),
                  iss({ id: 'B', status: 'Finalizada', created_at: dias(5) })];
    expect(computeRequesterDetail(data, P).issues.map(i => i.id)).toEqual(['A']);
    const todos = computeRequesterDetail(data, { ...P, scope: 'todos', from: '2026-06-01', to: '2026-06-30' });
    expect(todos.issues.map(i => i.id).sort()).toEqual(['A', 'B']);
  });

  it('marca estancado lo que nunca arranco y supera el umbral', () => {
    const r = computeRequesterDetail([
      iss({ id: 'PARADO', status: 'Backlog', created_at: dias(30) }),
      iss({ id: 'NUEVO', status: 'Backlog', created_at: dias(2) }),
      iss({ id: 'ANDANDO', status: 'IN PROGRESS', created_at: dias(30) }),
    ], P);
    const by = Object.fromEntries(r.issues.map(i => [i.id, i.estancado]));
    expect(by).toEqual({ PARADO: true, NUEVO: false, ANDANDO: false });
    expect(r.resumen.estancados).toBe(1);
  });

  it('resume abiertos, P1, edad maxima y mediana', () => {
    const r = computeRequesterDetail([
      iss({ id: 'A', created_at: dias(10), priority: 'High (P1)' }),
      iss({ id: 'B', created_at: dias(20), priority: 'Highest (P0)' }),
      iss({ id: 'C', created_at: dias(30), priority: 'Low (P3)' }),
      iss({ id: 'D', created_at: dias(40), priority: 'Mandatorio' }),
    ], P);
    expect(r.resumen.abiertos).toBe(4);
    expect(r.resumen.p1).toBe(3);
    expect(r.resumen.edad_max).toBe(40);
    expect(r.resumen.edad_p50).toBe(25);
  });

  it('el bucket sin dato se pide con requester null', () => {
    const r = computeRequesterDetail([iss({ id: 'A', requester: null, created_at: dias(5) })],
      { ...P, requester: null });
    expect(r.issues.map(i => i.id)).toEqual(['A']);
  });

  it('sin issues devuelve resumen en cero', () => {
    const r = computeRequesterDetail([], P);
    expect(r.issues).toEqual([]);
    expect(r.resumen).toEqual({ abiertos: 0, estancados: 0, p1: 0, edad_max: 0, edad_p50: 0 });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd shared/core && npx vitest run workload.test.ts`
Expected: FAIL — `computeRequesterDetail is not a function`.

- [ ] **Step 3: Implementar**

Agregar a `shared/core/workload.ts`:

```ts
import type { Talla } from './types';

export interface WorkloadIssue {
  id: string; title: string; status: string;
  assignee_id: string | null; talla: Talla | null; priority: string | null;
  created_at: string; edad_dias: number; estancado: boolean;
}
export interface RequesterDetail {
  issues: WorkloadIssue[];
  resumen: { abiertos: number; estancados: number; p1: number; edad_max: number; edad_p50: number };
}

const MS_DAY = 86_400_000;
const P1_PRIORITIES = ['Highest (P0)', 'High (P1)', 'Mandatorio'];

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function computeRequesterDetail(
  issues: CoreIssueWorkload[],
  params: {
    board_id: number; requester: string | null;
    scope: 'pendientes' | 'todos';
    from?: string; to?: string;
    agingThresholdDays: number; now: Date;
  },
): RequesterDetail {
  const t = params.now.getTime();

  const rows: WorkloadIssue[] = issues
    .filter(i => i.boards.includes(params.board_id) && i.requester === params.requester)
    .filter(i => params.scope === 'pendientes'
      ? isPendiente(i.status)
      : isPendiente(i.status) || enRango(i.created_at, params.from, params.to))
    .map(i => {
      const edad_dias = Math.floor((t - new Date(i.created_at).getTime()) / MS_DAY);
      const cat = categorize(i.status);
      const nuncaArranco = cat === 'todo' || cat === 'waiting';
      return {
        id: i.id, title: i.title, status: i.status,
        assignee_id: i.assignee_id, talla: i.talla, priority: i.priority,
        created_at: i.created_at, edad_dias,
        estancado: nuncaArranco && edad_dias > params.agingThresholdDays,
      };
    })
    .sort((a, b) => b.edad_dias - a.edad_dias || a.id.localeCompare(b.id));

  const abiertosRows = rows.filter(r => isPendiente(r.status));
  return {
    issues: rows,
    resumen: {
      abiertos: abiertosRows.length,
      estancados: rows.filter(r => r.estancado).length,
      p1: rows.filter(r => r.priority !== null && P1_PRIORITIES.includes(r.priority)).length,
      edad_max: rows.length ? Math.max(...rows.map(r => r.edad_dias)) : 0,
      edad_p50: mediana(rows.map(r => r.edad_dias)),
    },
  };
}
```

- [ ] **Step 4: Correr el test**

Run: `cd shared/core && npx vitest run workload.test.ts`
Expected: PASS, 15 tests en total.

- [ ] **Step 5: Commit**

```bash
git add shared/core/workload.ts shared/core/workload.test.ts
git commit -m "feat(core): computeRequesterDetail con resumen de estancados, P1 y antiguedad"
```

---

### Task 4: Server — migración de schema y persistencia en el sync

**Files:**
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/services/sync.ts`
- Test: `server/src/db/schema.test.ts`, `server/src/services/sync.test.ts`

**Interfaces:**
- Consumes: `mergeIssuesByBoard` de la Task 1.
- Produces: columnas `issues.requester`, `issues.boards`, `issues.priority` y `board_sync.name` pobladas por cada sync.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `server/src/db/schema.test.ts`:

```ts
it('agrega las columnas de carga de trabajo sobre una base preexistente', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE issues (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, assignee_id TEXT, talla TEXT, talla_confidence REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT NOT NULL, last_transition_at TEXT);
    CREATE TABLE board_sync (board_id INTEGER PRIMARY KEY, last_synced_at TEXT NOT NULL);
    INSERT INTO issues VALUES ('OPS-1','t','','Backlog',NULL,'M',0.9,'2026-01-01','2026-01-01','2026-01-01',NULL);`);
  applySchema(db);
  const cols = (db.prepare(`PRAGMA table_info(issues)`).all() as any[]).map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['requester', 'boards', 'priority']));
  const bcols = (db.prepare(`PRAGMA table_info(board_sync)`).all() as any[]).map(c => c.name);
  expect(bcols).toContain('name');
  // la migracion no puede tocar la talla existente
  expect((db.prepare(`SELECT talla FROM issues WHERE id='OPS-1'`).get() as any).talla).toBe('M');
});
```

**Primero, actualizar el mock existente.** El `vi.mock('./jira')` del tope de
`server/src/services/sync.test.ts` devuelve clients sin `fetchBoardName`, y el Step 3
de esta tarea hace que `runSync` lo llame. Sin este cambio **los tests que hoy pasan se
rompen** con `client.fetchBoardName is not a function`. Agregar al client existente:

```ts
    fetchBoardName: vi.fn().mockResolvedValue('Board Uno'),
```

y sumar los tres campos nuevos al issue `OPS-1` del mock (`requester: null, priority: null,
boards: [1]`), que ahora forman parte de `JiraIssueRaw`.

Después, agregar el test nuevo con su propio mock de dos boards:

```ts
const issueEn = (id: string, boards: number[]) => ({
  id, title: 'T', description: '', status: 'Backlog', assignee: null,
  requester: 'Tony Stack', priority: 'High (P1)', boards,
  created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
  transitions: [],
});

describe('runSync — carga de trabajo', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    applySchema(db);
    vi.resetModules();
    // DPP-1 esta en los dos boards; DPP-2 solo en 9536.
    vi.doMock('./jira', () => ({
      createJiraClients: () => [
        { boardId: 9534,
          fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9534])]),
          fetchBoardName: vi.fn().mockResolvedValue('Black Team Infra') },
        { boardId: 9536,
          fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9536]), issueEn('DPP-2', [9536])]),
          fetchBoardName: vi.fn().mockResolvedValue('Blue Team Infra') },
      ],
    }));
  });

  it('persiste requester, priority y la union de boards', async () => {
    const { runSync: run } = await import('./sync');
    await run(db);
    const a = db.prepare(`SELECT requester, priority, boards FROM issues WHERE id='DPP-1'`).get() as any;
    expect(a.requester).toBe('Tony Stack');
    expect(a.priority).toBe('High (P1)');
    expect(a.boards.split(',').map(Number).sort((x: number, y: number) => x - y)).toEqual([9534, 9536]);
    const b = db.prepare(`SELECT boards FROM issues WHERE id='DPP-2'`).get() as any;
    expect(b.boards).toBe('9536');
  });

  it('guarda el nombre de cada board en board_sync', async () => {
    const { runSync: run } = await import('./sync');
    await run(db);
    const rows = db.prepare(`SELECT board_id, name FROM board_sync ORDER BY board_id`).all() as any[];
    expect(rows).toEqual([
      { board_id: 9534, name: 'Black Team Infra' },
      { board_id: 9536, name: 'Blue Team Infra' },
    ]);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd server && npx vitest run src/db/schema.test.ts src/services/sync.test.ts`
Expected: FAIL — `no such column: requester`.

- [ ] **Step 3: Implementar**

En `server/src/db/schema.ts`, agregar las columnas a los `CREATE TABLE` (para bases nuevas) y las guardas de migración (para las existentes). Reemplazar el bloque final:

```ts
  const issueCols = db.prepare(`PRAGMA table_info(issues)`).all() as { name: string }[];
  for (const [col, ddl] of [
    ['talla_updated_at', `ALTER TABLE issues ADD COLUMN talla_updated_at TEXT`],
    ['requester',        `ALTER TABLE issues ADD COLUMN requester TEXT`],
    ['boards',           `ALTER TABLE issues ADD COLUMN boards TEXT`],
    ['priority',         `ALTER TABLE issues ADD COLUMN priority TEXT`],
  ] as const) {
    if (!issueCols.some(c => c.name === col)) db.exec(ddl);
  }

  const boardCols = db.prepare(`PRAGMA table_info(board_sync)`).all() as { name: string }[];
  if (!boardCols.some(c => c.name === 'name')) {
    db.exec(`ALTER TABLE board_sync ADD COLUMN name TEXT`);
  }
```

En el `CREATE TABLE IF NOT EXISTS issues`, agregar `requester TEXT, boards TEXT, priority TEXT` antes del cierre; en `board_sync`, agregar `name TEXT`.

En `server/src/services/sync.ts`, reemplazar `const issues = issueArrays.flat();` por:

```ts
    const issues = mergeIssuesByBoard(issueArrays);
```

con el import `import { mergeIssuesByBoard } from '../../../shared/core/jira';`.

En el `INSERT ... ON CONFLICT` de issues, agregar las tres columnas. `boards` se une con lo ya guardado en vez de pisarse:

```ts
        db.prepare(`
          INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence,
                              created_at, updated_at, synced_at, last_transition_at, requester, boards, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, description=excluded.description, status=excluded.status,
            assignee_id=excluded.assignee_id, talla=excluded.talla, talla_confidence=excluded.talla_confidence,
            updated_at=excluded.updated_at, synced_at=excluded.synced_at,
            last_transition_at=excluded.last_transition_at,
            requester=excluded.requester, priority=excluded.priority, boards=excluded.boards
        `).run(
          issue.id, issue.title, issue.description, issue.status,
          issue.assignee?.id ?? null, talla, talla_confidence,
          issue.created_at, issue.updated_at, now, lastTransition?.transitioned_at ?? null,
          issue.requester, issue.boards.slice().sort((a, b) => a - b).join(','), issue.priority
        );
```

> `talla` y `talla_confidence` siguen viniendo del `SELECT existing` de arriba: la talla ya clasificada se preserva igual que antes. **No tocar esas dos líneas.**

Guardar el nombre del board. En `server/src/services/jira.ts`, agregar a `JiraClient`:

```ts
  async fetchBoardName(): Promise<string | null> {
    try {
      const data = await axiosHttp({
        url: `${this.cfg.baseUrl}/rest/agile/1.0/board/${this.cfg.boardId}`,
        auth: { username: this.cfg.email, password: this.cfg.apiToken }, params: {},
      });
      return (data as any)?.name ?? null;
    } catch { return null; }   // el nombre es cosmetico: no debe romper el sync
  }
```

Y en `sync.ts`, donde se actualiza `board_sync`, persistirlo:

```ts
      const name = await client.fetchBoardName();
      db.prepare(`INSERT INTO board_sync (board_id, last_synced_at, name) VALUES (?,?,?)
                  ON CONFLICT(board_id) DO UPDATE SET last_synced_at=excluded.last_synced_at,
                  name=COALESCE(excluded.name, board_sync.name)`).run(client.boardId, syncedAt, name);
```

- [ ] **Step 4: Correr toda la suite del server**

Run: `cd server && npx vitest run`
Expected: PASS. **Verificar explícitamente que sigue pasando** `'preserves an already-classified talla on re-sync'`.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.ts server/src/services/sync.ts server/src/services/jira.ts \
        server/src/db/schema.test.ts server/src/services/sync.test.ts
git commit -m "feat(server): persistir requester, priority y procedencia de board en el sync"
```

---

### Task 5: Server — endpoint `GET /api/workload`

**Files:**
- Create: `server/src/services/workload.ts`
- Create: `server/src/routes/workload.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/routes.test.ts`

**Interfaces:**
- Consumes: `computeWorkload` (Task 2), `computeRequesterDetail` (Task 3), columnas de la Task 4.
- Produces: `GET /api/workload?from&to` → `WorkloadResult`; `GET /api/workload/detail?board_id&requester&scope&from&to` → `RequesterDetail`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `server/src/routes/routes.test.ts`:

```ts
it('GET /api/workload devuelve squads con sus solicitantes', async () => {
  const res = await request(app).get('/api/workload?from=2026-06-01&to=2026-06-30');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.squads)).toBe(true);
  expect(res.body.totals).toHaveProperty('compartidos');
});

it('GET /api/workload/detail filtra por board y solicitante', async () => {
  const res = await request(app).get('/api/workload/detail?board_id=9534&requester=Groot&scope=pendientes');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.issues)).toBe(true);
  expect(res.body.resumen).toHaveProperty('estancados');
});

it('GET /api/workload/detail sin board_id responde 400', async () => {
  expect((await request(app).get('/api/workload/detail')).status).toBe(400);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL — 404 en vez de 200.

- [ ] **Step 3: Implementar**

Crear `server/src/services/workload.ts`:

```ts
import Database from 'better-sqlite3';
import { computeWorkload, computeRequesterDetail } from '../../../shared/core/workload';
import type { WorkloadResult, RequesterDetail } from '../../../shared/core/workload';
import type { CoreIssueWorkload } from '../../../shared/core/types';

function agingThreshold(): number {
  return Math.max(1, parseInt(process.env.AGING_THRESHOLD_DAYS ?? '7', 10) || 7);
}

function loadIssues(db: Database.Database): CoreIssueWorkload[] {
  const rows = db.prepare(
    `SELECT id, title, status, assignee_id, talla, created_at, last_transition_at,
            requester, priority, boards FROM issues`
  ).all() as any[];
  return rows.map(r => ({
    ...r,
    boards: r.boards ? String(r.boards).split(',').map(Number).filter(n => !isNaN(n)) : [],
  }));
}

function loadBoards(db: Database.Database): { id: number; name: string }[] {
  return (db.prepare(`SELECT board_id AS id, name FROM board_sync ORDER BY board_id`).all() as any[])
    .map(b => ({ id: b.id, name: b.name ?? `Board ${b.id}` }));
}

export function getWorkload(db: Database.Database, params: { from?: string; to?: string }): WorkloadResult {
  return computeWorkload(loadIssues(db), loadBoards(db), params);
}

export function getRequesterDetail(
  db: Database.Database,
  params: { board_id: number; requester: string | null; scope: 'pendientes' | 'todos'; from?: string; to?: string },
): RequesterDetail {
  return computeRequesterDetail(loadIssues(db), {
    ...params, agingThresholdDays: agingThreshold(), now: new Date(),
  });
}
```

Crear `server/src/routes/workload.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../db/index';
import { getWorkload, getRequesterDetail } from '../services/workload';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(getWorkload(getDb(), { from: req.query.from as string, to: req.query.to as string }));
  } catch (err) { next(err); }
});

router.get('/detail', (req, res, next) => {
  try {
    const boardId = Number(req.query.board_id);
    if (!boardId) return res.status(400).json({ error: 'board_id requerido' });
    // requester ausente => bucket "sin dato" (null); string vacio se trata igual.
    const requester = req.query.requester === undefined || req.query.requester === ''
      ? null : String(req.query.requester);
    const scope = req.query.scope === 'todos' ? 'todos' as const : 'pendientes' as const;
    res.json(getRequesterDetail(getDb(), {
      board_id: boardId, requester, scope,
      from: req.query.from as string, to: req.query.to as string,
    }));
  } catch (err) { next(err); }
});

export default router;
```

En `server/src/index.ts`, junto a los otros routers:

```ts
import workloadRouter from './routes/workload';
app.use('/api/workload', workloadRouter);
```

- [ ] **Step 4: Correr los tests**

Run: `cd server && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/workload.ts server/src/routes/workload.ts server/src/index.ts server/src/routes/routes.test.ts
git commit -m "feat(server): endpoints GET /api/workload y /api/workload/detail"
```

---

### Task 6: Mobile — migración de schema y persistencia del crudo

**Files:**
- Modify: `mobile/lib/db.ts`
- Test: `mobile/__tests__/db.test.ts`, `mobile/__tests__/rawWriters.test.ts`

**Interfaces:**
- Consumes: `JiraIssueRaw` con `requester`/`priority`/`boards` (Task 1).
- Produces: mismas tres columnas en la base del mobile, más `workload_snapshot`, y `readWorkload(db)`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `mobile/__tests__/rawWriters.test.ts`:

```ts
it('guarda requester, priority y boards, y mergea boards entre syncs', async () => {
  const db = await getDb();
  await upsertRawIssues(db, [{
    id: 'DPP-1', title: 't', description: '', status: 'Backlog', assignee: null,
    requester: 'Groot', priority: 'High (P1)', boards: [9534],
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z', transitions: [],
  } as any]);
  await upsertRawIssues(db, [{
    id: 'DPP-1', title: 't', description: '', status: 'Backlog', assignee: null,
    requester: 'Groot', priority: 'High (P1)', boards: [9536],
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z', transitions: [],
  } as any]);
  const row = await db.getFirstAsync<any>(`SELECT requester, priority, boards FROM issues WHERE id='DPP-1'`);
  expect(row.requester).toBe('Groot');
  expect(row.priority).toBe('High (P1)');
  expect(row.boards.split(',').map(Number).sort()).toEqual([9534, 9536]);
});

it('no pisa una talla ya clasificada al reescribir el issue', async () => {
  const db = await getDb();
  const base = { id: 'DPP-9', title: 't', description: '', status: 'Backlog', assignee: null,
    requester: null, priority: null, boards: [9534],
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z', transitions: [] };
  await upsertRawIssues(db, [base as any]);
  await db.runAsync(`UPDATE issues SET talla='L' WHERE id='DPP-9'`);
  await upsertRawIssues(db, [base as any]);
  const row = await db.getFirstAsync<any>(`SELECT talla FROM issues WHERE id='DPP-9'`);
  expect(row.talla).toBe('L');
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd mobile && npx jest __tests__/rawWriters.test.ts`
Expected: FAIL — `no such column: requester`.

- [ ] **Step 3: Implementar**

En `mobile/lib/db.ts`, agregar `requester TEXT, boards TEXT, priority TEXT` al `CREATE TABLE IF NOT EXISTS issues`, la tabla nueva de snapshot, y extender la guarda de migración existente:

```ts
    CREATE TABLE IF NOT EXISTS workload_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
```

```ts
  const issueCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(issues)`);
  for (const [col, ddl] of [
    ['talla_pushed', `ALTER TABLE issues ADD COLUMN talla_pushed INTEGER NOT NULL DEFAULT 0`],
    ['requester',    `ALTER TABLE issues ADD COLUMN requester TEXT`],
    ['boards',       `ALTER TABLE issues ADD COLUMN boards TEXT`],
    ['priority',     `ALTER TABLE issues ADD COLUMN priority TEXT`],
  ] as const) {
    if (!issueCols.some(c => c.name === col)) await db.execAsync(ddl);
  }
```

En `upsertRawIssues`, agregar las tres columnas al INSERT y mergear `boards` leyendo lo previo:

```ts
      const prev = await db.getFirstAsync<{ boards: string | null }>(
        `SELECT boards FROM issues WHERE id = ?`, [issue.id]);
      const merged = [...new Set([
        ...(prev?.boards ? prev.boards.split(',').map(Number) : []),
        ...(issue.boards ?? []),
      ])].filter(n => !isNaN(n)).sort((a, b) => a - b).join(',');

      await db.runAsync(
        `INSERT INTO issues (id, title, description, status, assignee_id, created_at, updated_at,
                             last_transition_at, requester, boards, priority)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description, status=excluded.status,
           assignee_id=excluded.assignee_id, updated_at=excluded.updated_at,
           last_transition_at=excluded.last_transition_at,
           requester=excluded.requester, boards=excluded.boards, priority=excluded.priority`,
        [issue.id, issue.title, issue.description, issue.status, issue.assignee?.id ?? null,
         issue.created_at, issue.updated_at, lastTransition, issue.requester ?? null, merged, issue.priority ?? null]
      );
```

> El comentario de `db.ts:227` sigue vigente: `talla`/`talla_confidence` **no** se incluyen ni en el INSERT ni en el `ON CONFLICT`, así que la clasificación existente queda intacta.

Agregar el reader, junto a `readWipRisk`:

```ts
export async function readWorkload(db: SQLite.SQLiteDatabase): Promise<WorkloadResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM workload_snapshot WHERE id = 1');
  return row ? JSON.parse(row.result_json) : null;
}
```

Extender `loadCoreIssues` (`mobile/lib/db.ts:194`, la que alimenta `computeBundle`). **Cambiarle
el tipo de retorno a `CoreIssueWorkload[]`**, no solo agregar columnas al SELECT: así el
compilador garantiza que los campos llegan, en vez de que un cast los dé por supuestos.

```ts
export async function loadCoreIssues(db: SQLite.SQLiteDatabase): Promise<CoreIssueWorkload[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT id, title, status, assignee_id, talla, created_at, last_transition_at,
            requester, priority, boards FROM issues`);
  return rows.map(r => ({ ...r, boards: r.boards ? String(r.boards).split(',').map(Number) : [] }));
}
```

`CoreIssueWorkload extends CoreIssueWithTitle`, así que todo consumidor actual sigue compilando.

- [ ] **Step 4: Correr los tests**

Run: `cd mobile && npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/rawWriters.test.ts mobile/__tests__/db.test.ts
git commit -m "feat(mobile): columnas requester/boards/priority y tabla workload_snapshot"
```

---

### Task 7: Mobile — `workload` en el bundle y en ambos modos de sync

**Files:**
- Modify: `mobile/lib/snapshots.ts`
- Modify: `mobile/lib/directSync.ts`
- Modify: `mobile/lib/sync.ts`
- Modify: `mobile/lib/api.ts`
- Test: `mobile/__tests__/snapshots.test.ts`, `mobile/__tests__/computeBundle.test.ts`

**Interfaces:**
- Consumes: `computeWorkload` (Task 2), `readWorkload` (Task 6), `GET /api/workload` (Task 5).
- Produces: `SnapshotBundle.workload?: WorkloadResult`, escrito en `workload_snapshot` por los dos caminos de sync.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `mobile/__tests__/snapshots.test.ts`:

```ts
it('escribe y relee el snapshot de workload', async () => {
  const db = await getDb();
  const wl = { squads: [{ board_id: 9534, name: 'Black', pedidos: 3, pendientes: 1,
    requesters: [{ requester: 'Groot', pedidos: 3, pendientes: 1 }] }],
    totals: { pedidos: 3, pendientes: 1, compartidos: 0 } };
  await writeSnapshots(db, { workload: wl } as any, '2026-09-03T00:00:00.000Z');
  expect(await readWorkload(db)).toEqual(wl);
});
```

Agregar a `mobile/__tests__/computeBundle.test.ts`:

```ts
it('incluye workload en el bundle', () => {
  const bundle = computeBundle(
    [{ id: 'A', title: 't', status: 'Backlog', assignee_id: null, talla: null,
       created_at: '2026-06-10T00:00:00.000Z', last_transition_at: null,
       requester: 'Groot', priority: null, boards: [9534] } as any],
    [], [], { from: '2026-06-01', to: '2026-06-30' },
    new Date('2026-06-30T00:00:00.000Z'),
    [{ id: 9534, name: 'Black Team Infra' }],
  );
  expect(bundle.workload!.squads[0].requesters[0].requester).toBe('Groot');
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd mobile && npx jest __tests__/snapshots.test.ts __tests__/computeBundle.test.ts`
Expected: FAIL — `workload` undefined.

- [ ] **Step 3: Implementar**

En `mobile/lib/snapshots.ts`, agregar `workload?: WorkloadResult;` a `SnapshotBundle` y sumar la tabla al bloque genérico de snapshots JSON:

```ts
      [bundle.wipRisk, 'wip_risk_snapshot'],
      [bundle.bottleneck, 'bottleneck_snapshot'],
      [bundle.forecast, 'forecast_snapshot'],
      [bundle.workload, 'workload_snapshot'],
```

En `mobile/lib/directSync.ts`, `computeBundle` recibe un parámetro nuevo y devuelve el campo:

```ts
export function computeBundle(
  issues: CoreIssueWorkload[],
  transitions: CoreTransition[],
  members: CoreMember[],
  filters: { from?: string; to?: string; assignee?: string | null },
  now: Date = new Date(),
  boards: { id: number; name: string }[] = [],
): SnapshotBundle {
```

El parámetro pasa a `CoreIssueWorkload[]` (que extiende `CoreIssueWithTitle`) en vez de
castear adentro: si `loadCoreIssues` no trae los campos nuevos, falla la compilación en
vez de producir squads vacíos en silencio.

```ts
    workload: computeWorkload(issues, boards, params),
```

En el orquestador de `directSync`, leer los boards de `board_sync` (id + name) y pasarlos a `computeBundle`. Cuando el nombre esté en `NULL`, usar `Board {id}`.

En `mobile/lib/sync.ts` (backend mode), sumar `/api/workload` a las descargas y guardarlo en el bundle, con el mismo manejo de error por endpoint que ya usan los demás.

- [ ] **Step 4: Correr los tests**

Run: `cd mobile && npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/snapshots.ts mobile/lib/directSync.ts mobile/lib/sync.ts mobile/lib/api.ts \
        mobile/__tests__/snapshots.test.ts mobile/__tests__/computeBundle.test.ts
git commit -m "feat(mobile): workload en computeBundle y en los dos caminos de sync"
```

---

### Task 8: Mobile — hook y pantalla principal (layout B)

**Files:**
- Create: `mobile/hooks/useWorkload.ts`
- Create: `mobile/app/(tabs)/carga.tsx`
- Create: `mobile/components/SquadCard.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `readWorkload` (Task 6), `useFilterStore`/`dateRangeFor` de `mobile/store/filterStore.ts`.
- Produces: solapa `carga` navegable; cada fila de solicitante navega a `/requester/[board]/[requester]` (Task 9).

- [ ] **Step 1: Crear el hook**

`mobile/hooks/useWorkload.ts`, siguiendo el patrón de `useKPIs.ts`:

```ts
import { useEffect, useState } from 'react';
import { getDb, readWorkload } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { WorkloadResult } from '@teammetrics/core/workload';

export function useWorkload(): { workload: WorkloadResult | null; hasData: boolean } {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [workload, setWorkload] = useState<WorkloadResult | null>(null);
  useEffect(() => {
    (async () => setWorkload(await readWorkload(await getDb())))();
  }, [dataVersion]);
  return { workload, hasData: workload !== null };
}
```

- [ ] **Step 2: Crear `SquadCard`**

`mobile/components/SquadCard.tsx` recibe `{ squad: WorkloadSquad; rangeLabel: string; onPressRequester: (r: string | null) => void }` y renderiza:

1. Cabecera: punto de color + `squad.name`.
2. Fila de dos números con `Typography.number`: `Pedidos {rangeLabel}` (color `Colors.text`) y `Pendientes hoy` (color `Colors.warning`).
3. Top 3 de `squad.requesters`: nombre, barra proporcional al máximo de pedidos del squad, cantidad, badge de pendientes (`Colors.warning`, apagado a `Colors.textSubtle` si es 0), chevron.
4. Fila `Otros N equipos` con la suma de pedidos y pendientes del resto; al tocarla, `useState` local despliega el resto dentro de un `ScrollView` de `maxHeight: 200`.

El bucket `requester === null` se muestra con el texto `Sin dato` en `fontStyle: 'italic'` y `Colors.textMuted`, ordenado por su valor como cualquier otro.

Usar `Card.base`, `Colors` y `Typography` de `mobile/lib/theme.ts`. No introducir colores nuevos.

- [ ] **Step 3: Crear la pantalla**

`mobile/app/(tabs)/carga.tsx`:

- `useFilterStore` para el rango, con la misma barra de `30d/60d/90d/180d/360d` que usan las otras solapas (`DateRangeBar`).
- `useWorkload()` para los datos.
- Si `!hasData`, renderizar `<EmptyState />` con el texto `Sincronizá para ver la carga de trabajo`.
- Un `SquadCard` por elemento de `workload.squads`.
- Al pie, si `workload.totals.compartidos > 0`, la nota: `{n} issues están en los dos boards y se cuentan en ambos squads.` en `Typography.label`.

- [ ] **Step 4: Registrar la solapa**

En `mobile/app/(tabs)/_layout.tsx`, entre `equipo` e `issues`:

```tsx
      <Tabs.Screen name="carga" options={{ title: 'Carga', tabBarIcon: tabIcon('pie-chart') }} />
```

- [ ] **Step 5: Verificar que compila y que la suite sigue verde**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: sin errores de tipos, tests en verde.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useWorkload.ts mobile/components/SquadCard.tsx \
        "mobile/app/(tabs)/carga.tsx" "mobile/app/(tabs)/_layout.tsx"
git commit -m "feat(mobile): solapa Carga con tarjeta por squad y cola larga colapsable"
```

---

### Task 9: Mobile — drill-down por solicitante

**Files:**
- Create: `mobile/app/requester/[board]/[requester].tsx`
- Create: `mobile/hooks/useRequesterDetail.ts`
- Create: `mobile/components/WorkloadIssueRow.tsx`
- Modify: `mobile/lib/db.ts`

**Interfaces:**
- Consumes: `computeRequesterDetail` (Task 3), crudo local de `issues` (Task 6).
- Produces: pantalla de detalle alcanzable desde `SquadCard`.

- [ ] **Step 1: Reader local**

En `mobile/lib/db.ts`, agregar la lectura del crudo que alimenta el detalle — así el drill-down funciona **offline**, sin endpoint:

```ts
export async function readWorkloadIssues(db: SQLite.SQLiteDatabase): Promise<CoreIssueWorkload[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT id, title, status, assignee_id, talla, created_at, last_transition_at,
            requester, priority, boards FROM issues`);
  return rows.map(r => ({ ...r, boards: r.boards ? String(r.boards).split(',').map(Number) : [] }));
}
```

- [ ] **Step 2: Hook**

`mobile/hooks/useRequesterDetail.ts` llama a `readWorkloadIssues` y le aplica `computeRequesterDetail` con `agingThresholdDays: 7` y `now: new Date()`, memoizado por `[dataVersion, board, requester, scope, from, to]`.

- [ ] **Step 3: Fila de issue**

`mobile/components/WorkloadIssueRow.tsx` con `{ issue: WorkloadIssue }`:

- Línea 1: `issue.id` (`Colors.primaryLight`), chip de estado, y la edad a la derecha.
- Color de la edad, con `T = 7`: `Colors.textMuted` hasta `2T` (14d), `Colors.warning` entre `2T` y `8T` (15–56d), `Colors.error` por encima de `8T` (+56d).
- Línea 2: `issue.title`, `numberOfLines={2}`.
- Línea 3: nombre del responsable (resuelto contra `team_members`, o `sin asignar`), chip de prioridad, chip de talla. **Si `talla` es `null`, no renderizar el chip** — hay issues sin clasificar y un chip vacío confunde.

- [ ] **Step 4: Pantalla**

`mobile/app/requester/[board]/[requester].tsx`:

- `useLocalSearchParams()` para `board` y `requester`; el literal `__null__` en la URL representa el bucket "Sin dato".
- Cabecera: botón `‹ Carga`, breadcrumb `{nombre del board} · solicitante`, título con el nombre del solicitante.
- Toggle segmentado `Pendientes {n}` / `Todos {n}`, con `useState<'pendientes' | 'todos'>('pendientes')`.
- Tira de resumen: `{abiertos} abiertos · {estancados} sin arrancar hace +{T}d · {p1} son P1 · más viejo {edad_max}d · mediana {edad_p50}d`. Omitir los tramos cuyo valor sea 0.
- `FlatList` de `WorkloadIssueRow`, ya ordenada por antigüedad desde el core.

- [ ] **Step 5: Verificar**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: sin errores, tests en verde.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/requester" mobile/hooks/useRequesterDetail.ts \
        mobile/components/WorkloadIssueRow.tsx mobile/lib/db.ts
git commit -m "feat(mobile): drill-down de solicitante con resumen y orden por antiguedad"
```

---

### Task 10: Backfill

**Files:** ninguno — es una operación sobre `data/kanban.db`.

**Interfaces:**
- Consumes: todo lo anterior. **No arrancar esta tarea hasta que las Tasks 1-9 estén mergeadas**: un backfill previo baja 4099 issues y no completa ninguna columna nueva.

- [ ] **Step 1: Respaldar la base y registrar el estado de las tallas**

```bash
cp data/kanban.db "data/kanban.db.bak-$(date +%Y%m%d-%H%M)"
sqlite3 data/kanban.db "SELECT COUNT(*) AS con_talla FROM issues WHERE talla IS NOT NULL;"
```

Anotar ese número: es la verificación del constraint global.

- [ ] **Step 2: Forzar un sync completo**

El sync es incremental por `board_sync.last_synced_at`; vaciar esa marca sin perder el nombre del board:

```bash
sqlite3 data/kanban.db "UPDATE board_sync SET last_synced_at = '1970-01-01T00:00:00.000Z';"
npm run sync
```

- [ ] **Step 3: Verificar que las tallas no se tocaron**

```bash
sqlite3 data/kanban.db "SELECT COUNT(*) AS con_talla FROM issues WHERE talla IS NOT NULL;"
```

Expected: **igual o mayor** al número del Step 1. Si bajó, el backfill pisó tallas: restaurar el `.bak` y revisar el `ON CONFLICT` de la Task 4 antes de reintentar.

- [ ] **Step 4: Verificar la cobertura de las columnas nuevas**

```bash
sqlite3 data/kanban.db "
SELECT COUNT(*) total,
       SUM(boards IS NOT NULL) con_board,
       SUM(requester IS NOT NULL) con_requester,
       SUM(priority IS NOT NULL) con_priority FROM issues;
SELECT board_id, name, COUNT(*) FROM board_sync GROUP BY board_id;"
```

Expected: `con_board` ≈ `total`; `con_requester` en torno al 90-95% (el resto es el bucket legítimo "Sin dato"); `board_sync.name` con los dos nombres.

- [ ] **Step 5: Verificar la vista contra la realidad**

```bash
curl -s "http://localhost:3001/api/workload?from=$(date -v-90d +%F)&to=$(date +%F)" | head -c 600
```

Contrastar los totales con Jira. Referencia medida el 2026-09-03 en una ventana de 90 días: Black ~518 pedidos / 70 pendientes / 29 solicitantes; Blue ~582 / 43 / 27. Los números habrán cambiado, pero un orden de magnitud distinto indica un bug de agregación.

- [ ] **Step 6: Commit**

No hay cambios de código. Dejar registrado el resultado del backfill en el PR o en el log de la sesión.

---

## Self-review

**Cobertura del spec:**

| Sección del spec | Task |
|---|---|
| `requester` desde `customfield_13510` | 1 |
| `priority` | 1, 4, 6 |
| Squad por membresía al board, `mergeIssuesByBoard` | 1, 4 |
| Migración aditiva en las dos bases | 4, 6 |
| `board_sync.name` | 4 |
| `computeWorkload` + semántica pedidos/pendientes | 2 |
| Issue en dos boards cuenta en ambos, `totals.compartidos` | 2 |
| Bucket "Sin dato" | 2, 8 |
| `computeRequesterDetail` + resumen | 3 |
| Umbrales de `estancado` y color por `AGING_THRESHOLD_DAYS` | 3, 9 |
| `GET /api/workload` | 5 |
| `workload_snapshot`, `computeBundle`, direct mode | 6, 7 |
| Layout B con "Otros N equipos" desplegable | 8 |
| Drill-down con toggle, resumen y orden por antigüedad | 9 |
| Backfill sin reprocesar tallas | 10 |

**Riesgo abierto:** `computeBundle` gana un sexto parámetro (`boards`) con default `[]`. Todo llamador que no lo pase produce `workload` con squads vacíos en vez de fallar. La Task 7 debe actualizar **todos** los llamadores de `computeBundle` en `directSync.ts`, no solo el principal.
