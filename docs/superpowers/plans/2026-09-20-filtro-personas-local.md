# Filtro de personas local y multi-selección — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cambiar el filtro de personas (y el de fechas) recalcule las métricas en el dispositivo en vez de sincronizar contra el server, y que se puedan elegir varias personas a la vez.

**Architecture:** El crudo ya está completo en el celular y `computeBundle` ya calcula todo a partir de él — es lo que hace direct mode. Cambiar un filtro pasa a ser una llamada a `recomputeSnapshots` local seguida de `dataVersion++`, sin red. Para el multi-select se extrae la logica de `passesAssignee` (hoy privada en `scorecard.ts`) a `matchesAssignees` en `shared/core/filters.ts` y lo consumen los seis módulos que hoy comparan con `===`.

**Tech Stack:** TypeScript, React Native + expo-router, expo-sqlite, Zustand (con `persist`), Vitest (core), Jest (mobile).

**Spec:** `docs/superpowers/specs/2026-09-20-filtro-personas-local-design.md`

## Global Constraints

- **Cambiar un filtro no debe llamar al server.** Es el requisito central del pedido. Debe quedar cubierto por un test con el cliente HTTP mockeado que afirme cero llamadas.
- **Las dos convenciones de lista vacía son opuestas y no deben mezclarse.** En el store, `[]` = "todos" (sin filtro). En el core, `assignees: []` = "no matchea nada". La conversión va en un solo lugar: `selected.length > 0 ? selected : undefined`.
- **No reprocesar ni pisar tallas ya clasificadas.** Ningún cambio de este plan toca la clasificación, pero tampoco debe introducir escrituras sobre `talla`.
- **`@testing-library/react-native` NO funciona en este proyecto** (incompatible con el `jest-expo` instalado: `render()` devuelve un objeto sin queries). No usarla, no instalar dependencias, no tocar la config de jest. La lógica testeable va a módulos puros.
- **No introducir colores nuevos**: usar los tokens de `mobile/lib/theme.ts`.
- `assignee` singular se mantiene como alias deprecado hasta la Task 8, para no romper al server de golpe.

---

### Task 1: Core — helper `matchesAssignees` compartido

**Files:**
- Create: `shared/core/filters.ts`
- Create: `shared/core/filters.test.ts`
- Modify: `shared/core/types.ts:21,23`

**Interfaces:**
- Consumes: `CoreIssue` de `shared/core/types.ts`.
- Produces: `matchesAssignees(assigneeId: string | null, assignees?: string[]): boolean`, y `CoreFilter`/`FilterParams` con `assignees?: string[]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `shared/core/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesAssignees } from './filters';

describe('matchesAssignees', () => {
  it('sin filtro (undefined) matchea todo, incluso sin asignar', () => {
    expect(matchesAssignees('u1', undefined)).toBe(true);
    expect(matchesAssignees(null, undefined)).toBe(true);
  });

  it('lista vacia NO matchea nada', () => {
    // Convencion del core, opuesta a la del store. Se usa para el agregado de
    // un equipo sin miembros: no debe traer todos los issues por accidente.
    expect(matchesAssignees('u1', [])).toBe(false);
    expect(matchesAssignees(null, [])).toBe(false);
  });

  it('una persona matchea solo a esa', () => {
    expect(matchesAssignees('u1', ['u1'])).toBe(true);
    expect(matchesAssignees('u2', ['u1'])).toBe(false);
  });

  it('varias personas matchean a cualquiera de la lista', () => {
    expect(matchesAssignees('u2', ['u1', 'u2', 'u3'])).toBe(true);
    expect(matchesAssignees('u9', ['u1', 'u2', 'u3'])).toBe(false);
  });

  it('un issue sin asignar nunca matchea una lista con gente', () => {
    expect(matchesAssignees(null, ['u1'])).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd shared/core && npx vitest run filters.test.ts`
Expected: FAIL — no existe `./filters`.

- [ ] **Step 3: Implementar**

Crear `shared/core/filters.ts`:

```ts
// Extraido de scorecard.ts, donde ya se usaba para el agregado restringido del
// equipo. OJO con la convencion: `undefined` = sin filtro, `[]` = no matchea nada.
// El store del mobile usa la convencion OPUESTA ([] = todos), asi que quien arma
// los filtros debe convertir: selected.length > 0 ? selected : undefined.
export function matchesAssignees(assigneeId: string | null, assignees?: string[]): boolean {
  if (assignees === undefined) return true;
  if (assignees.length === 0) return false;
  return assigneeId != null && assignees.includes(assigneeId);
}
```

En `shared/core/types.ts`, cambiar las dos interfaces (líneas 21 y 23):

```ts
export interface CoreFilter { assignees?: string[]; talla?: string; status?: string; from?: string; to?: string; }

export interface FilterParams { assignees?: string[]; talla?: string; status?: string; from?: string; to?: string; }
```

- [ ] **Step 4: Correr el test**

Run: `cd shared/core && npx vitest run filters.test.ts`
Expected: PASS, 5 tests.

> La suite completa del core va a estar en rojo hasta la Task 3: los seis módulos siguen
> leyendo `params.assignee`, que ya no existe en el tipo. Es esperado.

- [ ] **Step 5: Commit**

```bash
git add shared/core/filters.ts shared/core/filters.test.ts shared/core/types.ts
git commit -m "feat(core): helper matchesAssignees y filtros por lista de personas"
```

---

### Task 2: Core — `scorecard` usa el helper compartido

**Files:**
- Modify: `shared/core/scorecard.ts:52-64,295`
- Test: `shared/core/scorecard.test.ts`

**Interfaces:**
- Consumes: `matchesAssignees` de la Task 1.
- Produces: `computeScorecard` acepta `params.assignees` y filtra las filas de miembros.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `shared/core/scorecard.test.ts`:

```ts
it('con assignees, la tabla muestra solo esas personas', () => {
  const r = computeScorecard(issues, transitions, members, { assignees: ['u1', 'u2'] }, NOW);
  expect(r.members.map(m => m.member.id).sort()).toEqual(['u1', 'u2']);
});

it('la fila Equipo agrega solo a las personas elegidas', () => {
  const todos = computeScorecard(issues, transitions, members, {}, NOW);
  const dos = computeScorecard(issues, transitions, members, { assignees: ['u1', 'u2'] }, NOW);
  // El agregado restringido no puede ser igual al del equipo completo si hay
  // mas miembros con datos: si lo fuera, el filtro no se estaria aplicando.
  expect(dos.members.length).toBeLessThan(todos.members.length);
  expect(dos.team).not.toEqual(todos.team);
});

it('sin assignees se comporta como antes: todos los miembros', () => {
  const r = computeScorecard(issues, transitions, members, {}, NOW);
  expect(r.members.length).toBeGreaterThan(2);
});
```

> Los fixtures `issues`, `transitions`, `members` y `NOW` ya existen al tope del archivo.
> El test asume al menos tres miembros con datos; si el fixture tiene menos, agregá un
> tercer miembro antes de escribir estos casos.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd shared/core && npx vitest run scorecard.test.ts`
Expected: FAIL — `assignees` se ignora y devuelve todos los miembros.

- [ ] **Step 3: Implementar**

En `shared/core/scorecard.ts`, borrar la función local `passesAssignee` (líneas 57-64) e
importar la compartida:

```ts
import { matchesAssignees } from './filters';
```

Reemplazar los usos de `passesAssignee(i, f)` por `matchesAssignees(i.assignee_id, f.assignees)`.
La interfaz `QueryFilter` pierde `assignee?: string` y queda:

```ts
interface QueryFilter { assignees?: string[]; tallas?: string[] }
```

En el cuerpo de `computeScorecard`, filtrar la lista de miembros antes de calcular sus filas:

```ts
  // El filtro de personas restringe QUE filas se muestran; cada una sigue
  // calculandose con sus propios issues.
  const visibles = params.assignees && params.assignees.length
    ? members.filter(m => params.assignees!.includes(m.id))
    : members;
```

Usar `visibles` donde antes se usaba `members` para armar las filas, y pasar los ids de
`visibles` como `includedIds` al agregado del equipo (línea 295), que ya acepta
`{ assignees: includedIds }`.

- [ ] **Step 4: Correr el test**

Run: `cd shared/core && npx vitest run scorecard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/core/scorecard.ts shared/core/scorecard.test.ts
git commit -m "feat(core): scorecard filtra filas por lista de personas"
```

---

### Task 3: Core — los seis módulos restantes

**Files:**
- Modify: `shared/core/metrics.ts:25,47,54`
- Modify: `shared/core/metricsExtra.ts:78,126,151`
- Modify: `shared/core/wipRisk.ts:75,89`
- Modify: `shared/core/bottleneck.ts:146-147`
- Modify: `shared/core/forecast.ts:127-128`
- Modify: `shared/core/comparison.ts:43,51,65,79,94`
- Test: los `.test.ts` correspondientes

**Interfaces:**
- Consumes: `matchesAssignees` de la Task 1.
- Produces: los seis módulos aceptan `assignees?: string[]` en vez de `assignee?: string`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `shared/core/metrics.test.ts` (los otros cinco archivos reciben el caso análogo,
adaptando el nombre de la función y su assert):

```ts
it('assignees con varias personas suma a todas', () => {
  const soloU1 = computeKpis(issues, transitions, { assignees: ['u1'] }, 7, NOW);
  const soloU2 = computeKpis(issues, transitions, { assignees: ['u2'] }, 7, NOW);
  const ambos  = computeKpis(issues, transitions, { assignees: ['u1', 'u2'] }, 7, NOW);
  expect(ambos.wip).toBe(soloU1.wip + soloU2.wip);
});

it('sin assignees no filtra nada', () => {
  const sinFiltro = computeKpis(issues, transitions, {}, 7, NOW);
  const conLista  = computeKpis(issues, transitions, { assignees: undefined }, 7, NOW);
  expect(conLista).toEqual(sinFiltro);
});

it('una persona sin issues da cero, no todos', () => {
  // El error clasico: tratar la lista vacia de resultados como "sin filtro".
  const r = computeKpis(issues, transitions, { assignees: ['nadie'] }, 7, NOW);
  expect(r.wip).toBe(0);
});
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `cd shared/core && npx vitest run`
Expected: FAIL en los seis módulos.

- [ ] **Step 3: Implementar**

Importar `matchesAssignees` en cada archivo y reemplazar. Los seis casos:

`metrics.ts:25` →
```ts
    if (!matchesAssignees(i.assignee_id, params.assignees)) continue;
```

`metrics.ts:47` →
```ts
  const byAssignee = (i: CoreIssue) => matchesAssignees(i.assignee_id, params.assignees);
```

`metrics.ts:54` →
```ts
    matchesAssignees(assigneeById.get(t.issue_id) ?? null, params.assignees)
```

`metricsExtra.ts:78` y `:126` →
```ts
      if (!matchesAssignees(issue.assignee_id, params.assignees)) continue;
```

`metricsExtra.ts:151` →
```ts
    if (!matchesAssignees(i.assignee_id, params.assignees)) return false;
```

`wipRisk.ts:75` cambia la firma a `opts: { now?: Date; assignees?: string[] } = {}`, y `:89` →
```ts
    if (!matchesAssignees(r.assignee_id, opts.assignees)) continue;
```

`bottleneck.ts:146-147` y `forecast.ts:127-128` usan el mismo patrón de set de ids:
```ts
  const ids = opts.assignees !== undefined
    ? new Set(allIssues.filter(i => matchesAssignees(i.assignee_id, opts.assignees)).map(i => i.id))
    : null;
```

`comparison.ts` cambia `assignee?: string | null` por `assignees?: string[]` en las firmas
de las líneas 43 y 65, y las comparaciones de `:51` y `:79` pasan a:
```ts
    if (!matchesAssignees(assigneeById.get(t.issue_id) ?? null, assignees)) continue;
```
La línea 94 pasa de `const assignee = opts.assignee ?? null;` a `const assignees = opts.assignees;`
y se propaga con ese nombre.

- [ ] **Step 4: Correr la suite completa del core**

Run: `npm test --prefix shared/core`
Expected: PASS, todos verdes. Los tests preexistentes que pasaban `assignee: 'u1'` deben
migrarse a `assignees: ['u1']` — es una migración mecánica, no relajes ninguna aserción.

- [ ] **Step 5: Commit**

```bash
git add shared/core
git commit -m "feat(core): los seis modulos de metricas filtran por lista de personas"
```

---

### Task 4: Server — adaptar al nuevo contrato del core

**Files:**
- Modify: `server/src/routes/metrics.ts:12-14`
- Modify: `server/src/services/workload.ts`
- Test: `server/src/routes/routes.test.ts`

**Interfaces:**
- Consumes: `FilterParams` con `assignees` de la Task 1.
- Produces: el server sigue aceptando `?assignee=u1` en la query y lo traduce a `assignees: ['u1']`.

**Por qué:** el cliente web (`client/`) usa `?assignee=` y no se toca en este trabajo. El
server debe seguir respondiendo igual; solo cambia cómo arma los filtros internamente.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `server/src/routes/routes.test.ts`:

```ts
it('GET /api/metrics?assignee=u1 sigue filtrando por esa persona', async () => {
  const res = await request(app).get('/api/metrics?assignee=u1');
  expect(res.status).toBe(200);
  const todos = await request(app).get('/api/metrics');
  // Si el parametro dejara de aplicarse, ambos responderian identico.
  expect(res.body).not.toEqual(todos.body);
});
```

> Requiere que el fixture del `beforeAll` tenga issues de al menos dos assignees
> distintos. Si no los tiene, agregalos antes de escribir el test.

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd server && npx vitest run src/routes/routes.test.ts`
Expected: FAIL — al compilar, `assignee` ya no existe en `FilterParams`.

- [ ] **Step 3: Implementar**

En `server/src/routes/metrics.ts`, `parseFilters` traduce el parámetro de query:

```ts
function parseFilters(q: any): FilterParams {
  // La API publica sigue aceptando ?assignee=<id> (el cliente web la usa asi).
  // El core ahora piensa en listas: se traduce aca, en un solo lugar.
  return {
    from: q.from, to: q.to, talla: q.talla, status: q.status,
    assignees: q.assignee ? [String(q.assignee)] : undefined,
  };
}
```

Aplicar la misma traducción donde `server/src/services/workload.ts` arme filtros con
assignee, si los arma.

- [ ] **Step 4: Correr la suite del server**

Run: `npm test --prefix server`
Expected: PASS, todos verdes.

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "refactor(server): traducir ?assignee= al contrato de listas del core"
```

---

### Task 5: Mobile — el store guarda una lista, con migración

**Files:**
- Modify: `mobile/store/filterStore.ts`
- Test: `mobile/__tests__/filterStore.test.ts` (crear)

**Interfaces:**
- Consumes: nada del core.
- Produces: `useFilterStore` con `assignees: string[]`, `setAssignees(ids: string[])`, `toggleAssignee(id: string)`, `clearAssignees()`.

- [ ] **Step 1: Escribir el test que falla**

Crear `mobile/__tests__/filterStore.test.ts`:

```ts
import { migrateFilters } from '../store/filterStore';

describe('migrateFilters', () => {
  it('convierte el formato viejo de una persona a lista', () => {
    expect(migrateFilters({ assignee: 'u1', talla: null, timeRange: '30d' }, 0))
      .toMatchObject({ assignees: ['u1'] });
  });

  it('el viejo null (= todos) se vuelve lista vacia', () => {
    expect(migrateFilters({ assignee: null, talla: null, timeRange: '30d' }, 0))
      .toMatchObject({ assignees: [] });
  });

  it('no toca el resto de los filtros', () => {
    const out = migrateFilters({ assignee: 'u1', talla: 'M', timeRange: '90d' }, 0);
    expect(out.talla).toBe('M');
    expect(out.timeRange).toBe('90d');
  });

  it('un estado ya migrado pasa sin cambios', () => {
    const nuevo = { assignees: ['u1', 'u2'], talla: null, timeRange: '30d' };
    expect(migrateFilters(nuevo, 1)).toMatchObject({ assignees: ['u1', 'u2'] });
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd mobile && npx jest __tests__/filterStore.test.ts`
Expected: FAIL — `migrateFilters` no existe.

- [ ] **Step 3: Implementar**

En `mobile/store/filterStore.ts`, reemplazar `assignee` por `assignees` en la interfaz y
el estado, y exportar la migración:

```ts
interface FilterState {
  assignees: string[];          // [] = todos (OJO: el core usa la convencion opuesta)
  talla: Talla | null;
  timeRange: TimeRange;
  setAssignees: (ids: string[]) => void;
  toggleAssignee: (id: string) => void;
  clearAssignees: () => void;
  setTalla: (t: Talla | null) => void;
  setTimeRange: (r: TimeRange) => void;
}

// v0 guardaba `assignee: string | null`. Sin esto, un celular ya instalado abre
// con assignees undefined y rompe al iterarlo.
export function migrateFilters(persisted: any, version: number): any {
  if (version >= 1) return persisted;
  const { assignee, ...rest } = persisted ?? {};
  return { ...rest, assignees: assignee ? [assignee] : [] };
}
```

Las acciones:

```ts
      assignees: [],
      setAssignees: (assignees) => set({ assignees }),
      toggleAssignee: (id) => set(s => ({
        assignees: s.assignees.includes(id)
          ? s.assignees.filter(a => a !== id)
          : [...s.assignees, id],
      })),
      clearAssignees: () => set({ assignees: [] }),
```

Y en las opciones de `persist`, agregar `version: 1` y `migrate: migrateFilters`.

- [ ] **Step 4: Correr el test**

Run: `cd mobile && npx jest __tests__/filterStore.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/store/filterStore.ts mobile/__tests__/filterStore.test.ts
git commit -m "feat(mobile): el filtro de personas guarda una lista, con migracion del formato viejo"
```

---

### Task 6: Mobile — recálculo local en vez de sync

**Files:**
- Modify: `mobile/lib/directSync.ts:204` (exportar `recomputeSnapshots`)
- Modify: `mobile/store/syncStore.ts`
- Test: `mobile/__tests__/recompute.test.ts` (crear)

**Interfaces:**
- Consumes: `recomputeSnapshots(db, filters, now, syncedAt)` de `directSync.ts`, `useFilterStore` de la Task 5.
- Produces: `useSyncStore().recompute(): Promise<void>` — recalcula desde el crudo local y hace `dataVersion++`, sin red.

- [ ] **Step 1: Escribir el test que falla**

Crear `mobile/__tests__/recompute.test.ts`. **Este es el test central del pedido:**

```ts
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

jest.mock('../lib/directSync', () => ({
  ...jest.requireActual('../lib/directSync'),
  recomputeSnapshots: jest.fn().mockResolvedValue(undefined),
}));

import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import { recomputeSnapshots } from '../lib/directSync';

describe('recompute', () => {
  beforeEach(() => { mockFetch.mockClear(); (recomputeSnapshots as jest.Mock).mockClear(); });

  it('NO llama al server', async () => {
    await useSyncStore.getState().recompute();
    expect(mockFetch).not.toHaveBeenCalled();   // el requisito del pedido
  });

  it('bumpea dataVersion para que los hooks relean', async () => {
    const antes = useSyncStore.getState().dataVersion;
    await useSyncStore.getState().recompute();
    expect(useSyncStore.getState().dataVersion).toBe(antes + 1);
  });

  it('convierte la lista vacia del store a undefined para el core', async () => {
    // Store: [] = todos. Core: [] = nada. Sin la conversion, no elegir a nadie
    // mostraria cero datos.
    useFilterStore.getState().setAssignees([]);
    await useSyncStore.getState().recompute();
    expect((recomputeSnapshots as jest.Mock).mock.calls[0][1].assignees).toBeUndefined();
  });

  it('pasa la lista tal cual cuando hay gente elegida', async () => {
    useFilterStore.getState().setAssignees(['u1', 'u2']);
    await useSyncStore.getState().recompute();
    expect((recomputeSnapshots as jest.Mock).mock.calls[0][1].assignees).toEqual(['u1', 'u2']);
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd mobile && npx jest __tests__/recompute.test.ts`
Expected: FAIL — `recompute` no existe en el store.

- [ ] **Step 3: Implementar**

En `mobile/lib/directSync.ts:204`, exportar la función que hoy es privada:

```ts
export async function recomputeSnapshots(
```

En `mobile/store/syncStore.ts`, agregar la acción. `computeBundle` necesita `assignee`
como lo espera hoy su firma; se le pasa la lista ya convertida:

```ts
  recompute: async () => {
    const { timeRange, assignees } = useFilterStore.getState();
    const range = dateRangeFor(timeRange);
    const db = await getDb();
    const now = new Date();
    // Store: [] = todos  →  core: undefined = sin filtro. La conversion vive
    // SOLO aca; pasar [] derecho al core no traeria nada.
    await recomputeSnapshots(db, {
      from: range.from, to: range.to,
      assignees: assignees.length > 0 ? assignees : undefined,
    }, now, new Date().toISOString());
    set({ dataVersion: get().dataVersion + 1 });
  },
```

Agregar `recompute: () => Promise<void>;` a la interfaz del store.

`computeBundle` y `recomputeSnapshots` deben aceptar `filters.assignees?: string[]` en
lugar de `assignee`; ajustar sus firmas y los llamadores de `directSync`.

- [ ] **Step 4: Correr la suite completa del mobile**

Run: `npm test --prefix mobile`
Expected: PASS. **No commitear con tests en rojo.**

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/directSync.ts mobile/store/syncStore.ts mobile/__tests__/recompute.test.ts
git commit -m "feat(mobile): recompute local sin llamar al server"
```

---

### Task 7: Mobile — el selector de personas

**Files:**
- Create: `mobile/lib/personFilter.ts`
- Create: `mobile/__tests__/personFilter.test.ts`
- Create: `mobile/components/PersonFilterSheet.tsx`
- Modify: `mobile/components/DateRangeBar.tsx`
- Modify: `mobile/app/(tabs)/ajustes.tsx`

**Interfaces:**
- Consumes: `useFilterStore` (Task 5), `useSyncStore().recompute` (Task 6), `readTeamMemberNames(db)` de `mobile/lib/db.ts`.
- Produces: `filterMembers`, `personFilterLabel` en `personFilter.ts`; componente `<PersonFilterSheet />`.

- [ ] **Step 1: Escribir los tests de la lógica pura**

Crear `mobile/__tests__/personFilter.test.ts`:

```ts
import { filterMembers, personFilterLabel } from '../lib/personFilter';

const members = [
  { id: 'u1', name: 'Ailen Rodríguez' },
  { id: 'u2', name: 'Emanuel Pozarnik' },
  { id: 'u3', name: 'Fabricio Linares' },
];

describe('filterMembers', () => {
  it('sin texto devuelve todos', () => {
    expect(filterMembers(members, '')).toHaveLength(3);
  });

  it('filtra por coincidencia parcial, sin importar mayusculas', () => {
    expect(filterMembers(members, 'eman').map(m => m.id)).toEqual(['u2']);
    expect(filterMembers(members, 'EMAN').map(m => m.id)).toEqual(['u2']);
  });

  it('matchea por apellido, no solo por el principio', () => {
    expect(filterMembers(members, 'linares').map(m => m.id)).toEqual(['u3']);
  });

  it('ignora acentos: buscar "rodriguez" encuentra "Rodríguez"', () => {
    expect(filterMembers(members, 'rodriguez').map(m => m.id)).toEqual(['u1']);
  });

  it('sin coincidencias devuelve lista vacia', () => {
    expect(filterMembers(members, 'zzz')).toEqual([]);
  });
});

describe('personFilterLabel', () => {
  it('sin nadie elegido dice Todos', () => {
    expect(personFilterLabel([], members)).toBe('Todos');
  });

  it('con una persona muestra su nombre', () => {
    expect(personFilterLabel(['u2'], members)).toBe('Emanuel Pozarnik');
  });

  it('con varias muestra la cuenta', () => {
    expect(personFilterLabel(['u1', 'u2'], members)).toBe('2 personas');
  });

  it('un id que ya no esta en la lista no rompe', () => {
    // Puede pasar si alguien sale del equipo con el filtro guardado.
    expect(personFilterLabel(['borrado'], members)).toBe('1 persona');
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd mobile && npx jest __tests__/personFilter.test.ts`
Expected: FAIL — no existe `../lib/personFilter`.

- [ ] **Step 3: Implementar la lógica pura**

Crear `mobile/lib/personFilter.ts`:

```ts
export interface MemberOption { id: string; name: string }

// Normaliza para que "rodriguez" encuentre "Rodríguez": con 40 nombres, exigir
// los acentos hace que el buscador parezca roto.
function norm(s: string): string {
  // El rango va escrito como escapes (\u0300-\u036f) a proposito: son marcas
  // combinantes invisibles, y pegarlas literales en el fuente las corrompe.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterMembers(members: MemberOption[], query: string): MemberOption[] {
  const q = norm(query.trim());
  if (!q) return members;
  return members.filter(m => norm(m.name).includes(q));
}

export function personFilterLabel(selected: string[], members: MemberOption[]): string {
  if (selected.length === 0) return 'Todos';
  if (selected.length === 1) {
    return members.find(m => m.id === selected[0])?.name ?? '1 persona';
  }
  return `${selected.length} personas`;
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd mobile && npx jest __tests__/personFilter.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Crear la hoja**

`mobile/components/PersonFilterSheet.tsx`: un `Modal` de React Native con
`animationType="slide"` y `presentationStyle="pageSheet"`. Contiene:

- Cabecera con el título `Personas` y un botón `Listo` que cierra.
- Un `TextInput` de búsqueda (`autoCapitalize="none"`, `autoCorrect={false}`) cuyo valor
  alimenta `filterMembers`.
- Una fila `Todos` que llama a `clearAssignees()`, marcada cuando `assignees.length === 0`.
- Una `FlatList` de los miembros filtrados; cada fila llama a `toggleAssignee(m.id)` y
  muestra un check cuando está seleccionada.

Al cerrar (`Listo`), llamar a `recompute()`. **No llamar a `recompute()` en cada toggle**:
con 40 personas y varios toques seguidos serían varios recálculos innecesarios.

Usar `Colors`, `Typography` y `Card` de `mobile/lib/theme.ts`.

- [ ] **Step 6: Conectar la barra superior**

En `mobile/components/DateRangeBar.tsx`, agregar debajo de los chips de rango un
`TouchableOpacity` que muestre `personFilterLabel(assignees, members)` y abra la hoja.
Los miembros se leen una vez con `readTeamMemberNames(db)` en un `useEffect`.

Y en el mismo archivo, cambiar el handler del rango:

```ts
  const handleSelect = (range: TimeRange) => {
    if (range === timeRange) return;
    setTimeRange(range);
    recompute();     // antes: sync() — iba al server sin necesidad
  };
```

- [ ] **Step 7: Sacar el filtro viejo de Ajustes**

En `mobile/app/(tabs)/ajustes.tsx`, borrar `handleSetAssignee` y los controles de
selección de persona: ahora viven en la barra superior. El resto de la pantalla
(URL del server, credenciales de direct mode, botones de Sync y Reclasificar) no se toca.

- [ ] **Step 8: Verificar**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: sin errores de tipos, toda la suite en verde.

- [ ] **Step 9: Commit**

```bash
git add mobile/lib/personFilter.ts mobile/__tests__/personFilter.test.ts \
        mobile/components/PersonFilterSheet.tsx mobile/components/DateRangeBar.tsx \
        "mobile/app/(tabs)/ajustes.tsx"
git commit -m "feat(mobile): selector de personas en la barra superior, con busqueda"
```

---

### Task 8: Mobile — frescura del crudo y fin del alias `assignee`

**Files:**
- Modify: `mobile/lib/syncStatus.ts`
- Modify: `mobile/components/SyncHeader.tsx`
- Modify: `mobile/app/(tabs)/ajustes.tsx:39-45`
- Test: `mobile/__tests__/syncStatus.test.ts`

**Interfaces:**
- Consumes: `getBoardLastSync(db, 0)` de `mobile/lib/db.ts` — el centinela del crudo.
- Produces: la cabecera refleja la antigüedad del crudo, no la de los snapshots.

**Por qué:** después de la Task 6 los números salen del crudo. Si el pull del crudo falla,
la cabecera diría "sync recién" con números viejos, y `ajustes.tsx:39-45` silencia ese
fallo a propósito. Esa supresión era correcta cuando el crudo era accesorio; deja de serlo
cuando es la fuente de todo.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `mobile/__tests__/syncStatus.test.ts`:

> **OJO con la firma.** `syncStatusText` ya tiene cuatro parámetros:
> `(status, lastSyncedAt, mode?, now: number = Date.now())`. El nuevo va **quinto**, no
> cuarto: poner el timestamp del crudo en la posición de `now` es un error de tipos
> (string donde se espera number) y, si alguien lo castea, rompe el cálculo de antigüedad.

```ts
const AHORA = Date.parse('2026-09-20T12:00:00Z');

it('la antiguedad sale del crudo, no del snapshot', () => {
  // Snapshot fresco pero crudo viejo: los numeros que se ven son viejos.
  const t = syncStatusText('ok', '2026-09-20T12:00:00Z', 'backend', AHORA, '2026-09-04T12:00:00Z');
  expect(t).toMatch(/16\s*d/);
});

it('sin crudo todavia, cae al timestamp del snapshot', () => {
  const t = syncStatusText('ok', '2026-09-20T12:00:00Z', 'backend', AHORA, undefined);
  expect(t).toBeTruthy();
  expect(t).not.toMatch(/16\s*d/);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd mobile && npx jest __tests__/syncStatus.test.ts`
Expected: FAIL — `syncStatusText` no acepta el cuarto argumento.

- [ ] **Step 3: Implementar**

`syncStatusText` gana un **quinto** parámetro, después de `now`:

```ts
export function syncStatusText(
  status: SyncStatus,
  lastSyncedAt: string | null,
  mode?: 'backend' | 'direct' | null,
  now: number = Date.now(),
  rawSyncedAt?: string | null,   // ← nuevo
): string {
```

Calcula la antigüedad sobre `rawSyncedAt` cuando está presente y cae a `lastSyncedAt`
cuando no: después de la Task 6 los números salen del crudo, así que esa es la fecha que
le importa al usuario.

`SyncHeader` lee el centinela con `getBoardLastSync(db, 0)` en un `useEffect` y se lo pasa.

En `mobile/app/(tabs)/ajustes.tsx:39-45`, sacar `/api/raw` de los silenciados:

```ts
    // /api/tallas sigue siendo best-effort de verdad: reintenta solo en el
    // proximo sync. /api/raw ya NO: de ahi salen todos los numeros, asi que un
    // fallo tiene que verse.
    const relevantes = st.errors.filter(e => e.endpoint !== '/api/tallas');
    if (relevantes.length > 0) {
      const raw = relevantes.find(e => e.endpoint === '/api/raw');
      Alert.alert(
        raw ? 'No se pudieron bajar los datos nuevos' : 'Sync parcial',
        raw
          ? 'Los números que ves son los de la última sincronización exitosa.'
          : `${relevantes.length} endpoint(s) fallaron:\n${relevantes.map(e => `${e.endpoint}: ${e.message}`).join('\n\n')}`
      );
    }
```

- [ ] **Step 4: Sacar el alias deprecado**

Buscar `assignee` singular en `shared/core` y `mobile` (`grep -rn "assignee[^s_]" shared/core mobile/lib mobile/store`)
y eliminar los restos del alias. `assignee_id` en los issues **no se toca**: es el campo
del dato, no el filtro.

- [ ] **Step 5: Verificar todo**

Run: `npm test --prefix shared/core && npm test --prefix server && npm test --prefix mobile`
Expected: las tres suites en verde.
Run: `cd mobile && npx tsc --noEmit && cd ../server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add mobile server shared
git commit -m "feat(mobile): la cabecera refleja la frescura del crudo y el fallo de /api/raw deja de silenciarse"
```

---

## Self-review

**Cobertura del spec:**

| Requisito del spec | Task |
|---|---|
| Cálculo local al cambiar filtro, sin red | 6 |
| Test de que no llama al server | 6 |
| `passesAssignee` extraído a `matchesAssignees` y compartido | 1 |
| Los seis módulos del core filtran por lista | 3 |
| Scorecard filtra filas + agrega el subconjunto | 2 |
| Conversión `[]` store → `undefined` core, en un solo lugar | 1 (documentado), 6 (aplicado y testeado) |
| Store con lista + migración del formato viejo | 5 |
| Botón en la barra superior + hoja con búsqueda | 7 |
| Etiqueta `Todos` / nombre / `N personas` | 7 |
| Indicador de frescura leyendo el crudo | 8 |
| `/api/raw` deja de silenciarse | 8 |
| `assignee` singular se elimina al final | 8 |
| El server sigue aceptando `?assignee=` | 4 |

**Fuera del spec, incluido a propósito:** el `sync()` de `DateRangeBar.tsx` (Task 7, Step 6).
Es la misma causa en un control más visible; arreglar solo el filtro de personas dejaría
el de fechas lento en la misma barra.

**Riesgo abierto:** la Task 3 migra tests preexistentes de `assignee: 'u1'` a
`assignees: ['u1']`. Es mecánico, pero es la clase de cambio donde una aserción se relaja
sin que nadie lo note. El revisor de esa tarea debe verificar que ninguna cambió de
significado.
