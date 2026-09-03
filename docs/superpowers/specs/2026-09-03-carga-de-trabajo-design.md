# Solapa "Carga de trabajo" (mobile) — diseño

**Fecha:** 2026-09-03
**Estado:** aprobado, listo para plan de implementación

## Problema

El tablero responde bien "cómo fluye el trabajo" (cycle time, throughput, WIP, forecast),
pero no responde **"quién me pide y cuánto le debo"**. Para priorizar y negociar con los
equipos solicitantes hace falta ver la demanda partida por squad y por quién la origina.

## Objetivo

Una solapa nueva en el mobile que muestre, por squad y por equipo solicitante:

- **pedidos** — issues creados dentro del rango de fechas, incluidos los ya cerrados
- **pendientes** — issues abiertos hoy

Y que al tocar un solicitante muestre sus tickets con la info que permite diagnosticar
por qué están parados.

---

## Hallazgos de datos

Exploración contra Jira (proyecto DPP, boards 9534 y 9536) que condiciona todo el diseño.

### El campo "Producto" no sirve

`customfield_11851` ("Producto") está poblado en el **30%** del histórico y en apenas el
**4% de los pendientes**. Una vista agrupada por ese campo sería una barra gigante de
"sin dato". **Descartado.**

### El eje "producto" es "Equipo que hace el pedido"

`customfield_13510` ("Equipo que hace el pedido"): **91% poblado en pendientes, 95% en
los últimos 12 meses**, ~25 valores distintos (Groot, Tony Stack, PDS 3ros, Snake,
Arquitectura, FMP…). Es la dimensión que responde la pregunta.

Otros campos candidatos descartados por estar vacíos: `customfield_13704`
("Equipo solicitante") y `customfield_13732` ("Tribu/Plataforma/Equipo solicitante"),
ambos 0%.

### El squad sale del board, no del campo

| fuente | resultado |
|---|---|
| campo `customfield_11315` "Equipos de Trabajo" | 65% de los pendientes dice `Black\|Blue` — nadie lo mantiene |
| membresía al board | Black 70, Blue 43, solo **7 solapados** |

Los boards parten el trabajo casi limpio. **El squad se deriva de la membresía al board.**

- board `9534` → "Black Team Infra"
- board `9536` → "Blue Team Infra"

### Volumen real (ventana de 90 días)

| squad | pedidos | pendientes | solicitantes distintos |
|---|---|---|---|
| Black | 518 | 70 | 29 |
| Blue | 582 | 43 | 27 |

Hay **cola larga**: la mitad de los solicitantes tiene 1 o 2 pedidos. El layout tiene que
manejar ~29 filas por squad sin volverse ilegible.

### Huecos conocidos

- **"Sin dato" en Black: 82 pedidos y 31 pendientes** (44% de lo abierto de ese squad).
  Es un bucket legítimo, no un bug: se muestra como una fila más, ordenada por su valor,
  pero con estilo apagado (itálica, gris) para distinguirla de un equipo real.
- El historial local cubre desde 2023-11, ~400 issues/mes: alcanza para los rangos de
  30d a 360d que ya expone `filterStore`.

---

## Arquitectura

Sigue la estructura existente: lógica pura en `shared/core`, el server la expone por REST,
el mobile la consume por snapshot y también la calcula sola en *direct mode*.

### 1. Schema (migración aditiva, en las dos bases)

Mismo patrón ya usado para `talla_pushed` y `talla_updated_at`
(`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`):

| tabla | columna | contenido |
|---|---|---|
| `issues` | `requester TEXT` | equipo solicitante; `NULL` si Jira no lo trae |
| `issues` | `boards TEXT` | IDs de board separados por coma (`"9534"` / `"9534,9536"`) |
| `issues` | `priority TEXT` | prioridad Jira, para el drill-down |
| `board_sync` | `name TEXT` | nombre del board, traído del propio sync |

Se guardan **IDs de board**, no las etiquetas "black"/"blue": si renombran un board o
aparece un tercer squad no hay que tocar código, y no suma configuración nueva al `.env`.
El nombre se resuelve por `board_sync`, y lo obtiene el sync desde
`GET /rest/agile/1.0/board/{id}`.

### 2. Fetch (`shared/core/jira.ts`)

- `parseJiraIssue` suma `requester` desde `customfield_13510` (queda puro: no sabe de boards).
- El campo se agrega a la lista `fields` del request.
- `fetchBoardIssues` etiqueta cada issue con `boards: [cfg.boardId]`, que es dato que ya tiene.
- **Función nueva `mergeIssuesByBoard(issueArrays)`**: dedupea por `id` y hace la unión de
  `boards`. Reemplaza al `.flat()` de `sync.ts`, que hoy pierde la procedencia y además
  deja que el segundo upsert de un issue duplicado pise al primero.
- En el upsert, `boards` se mergea en vez de pisarse, igual que hoy se preserva `talla`.

### 3. Agregación (`shared/core/workload.ts`, nuevo)

```ts
export interface WorkloadRequester {
  requester: string | null;   // null → bucket "Sin dato"
  pedidos: number;
  pendientes: number;
}
export interface WorkloadSquad {
  board_id: number; name: string;
  pedidos: number; pendientes: number;
  requesters: WorkloadRequester[];   // ordenados por pedidos desc
}
export interface WorkloadResult {
  squads: WorkloadSquad[];
  totals: { pedidos: number; pendientes: number; compartidos: number };
}

export function computeWorkload(
  issues: CoreIssueWorkload[],
  boards: { id: number; name: string }[],
  params: { from?: string; to?: string },
): WorkloadResult
```

`CoreIssueWorkload extends CoreIssue` con `requester` y `boards`, siguiendo la convención
ya documentada para `CoreIssueWithTitle`.

**Semántica, explícita:**

- `pedidos` = `created_at` dentro de `[from, to]`, incluidos los cerrados.
- `pendientes` = abiertos **hoy**, sin filtrar por fecha. Se reusa `categorize()` de
  `statusCategories.ts`: pendiente = no cae en `done` ni `cancelled`.

Que `pendientes` **no** respete el rango es deliberado: si filtrara, un ticket abierto hace
ocho meses desaparecería al elegir "30d", y es justo el que más pesa. Son dos preguntas
distintas — cuánto entró en la ventana, y cuánto se debe hoy.

Un issue presente en los dos boards **cuenta en ambos squads**. Por eso Black + Blue puede
sumar más que el total; `totals.compartidos` expone ese número para que la UI lo explique
en vez de parecer un error.

### 4. Resumen del drill-down (`shared/core/workload.ts`)

```ts
export interface WorkloadIssue {
  id: string; title: string; status: string;
  assignee_id: string | null; talla: Talla | null;
  priority: string | null;
  created_at: string;
  edad_dias: number;                // días desde created_at
  estancado: boolean;
}
export interface RequesterDetail {
  issues: WorkloadIssue[];          // ordenados por edad_dias desc
  resumen: {
    abiertos: number; estancados: number;
    p1: number; edad_max: number; edad_p50: number;
  };
}
```

Es lo que convierte la lista en diagnóstico en vez de volcado.

**Definiciones, sin ambigüedad:**

- `edad_dias` = días desde `created_at` hasta hoy.
- `estancado` = el issue sigue en categoría `todo` o `waiting` (nunca arrancó) **y**
  `edad_dias > AGING_THRESHOLD_DAYS`. Se reusa la variable de entorno que ya consume
  `metrics.ts` (default 7), en vez de introducir un umbral nuevo.
- `p1` = cuenta de issues con prioridad `Highest (P0)`, `High (P1)` o `Mandatorio`.
- Umbrales de color de la edad, múltiplos del mismo `AGING_THRESHOLD_DAYS` (T):
  gris hasta `2T`, naranja entre `2T` y `8T`, rojo por encima de `8T`.
  Con el default de 7 días eso da: gris ≤14d, naranja 15–56d, rojo +56d.

`priority` es un campo nuevo: se agrega al request (`fields=…,priority`), a
`parseJiraIssue`, y como columna `issues.priority TEXT` en las dos bases — el drill-down
lee del crudo local, así que necesita estar persistido para funcionar offline.

### 5. Server

`GET /api/workload?from&to` → `WorkloadResult`, misma convención de filtros que el resto
de los endpoints.

### 6. Mobile

- Tabla `workload_snapshot (id, result_json, synced_at)`, idéntica a `wip_risk_snapshot` /
  `bottleneck_snapshot` / `forecast_snapshot`.
- `computeBundle` suma `workload` al bundle → *direct mode* cubierto sin código aparte.
- Hook `useWorkload`, en la línea de `useKPIs` / `useTeam`.
- Solapa nueva `carga` en `app/(tabs)/`, ícono `pie-chart`.

El drill-down lee los issues del crudo local (`issues`), así que **funciona offline** y no
necesita endpoint propio.

---

## UI

### Pantalla principal (layout B)

Por cada squad:

1. Cabecera con nombre y punto de color.
2. Los dos números en grande: **Pedidos {rango}** y **Pendientes hoy** (naranja).
3. Top 3 solicitantes: nombre, barra proporcional, cantidad de pedidos, badge naranja de
   pendientes, chevron.
4. Fila **"Otros N equipos"** con sus totales, que se despliega en lista scrolleable.
   Toda fila es tappable — sin esto, la mayoría de los solicitantes serían inalcanzables.

Filtro de rango arriba (30d/60d/90d/180d/360d), reusando `filterStore` y `dateRangeFor`.

Al pie, nota fija: los issues compartidos se cuentan en los dos squads.

### Drill-down por solicitante

- Cabecera: breadcrumb `{squad} · solicitante`, nombre del equipo.
- Toggle **Pendientes N / Todos N** — "Todos" trae también los cerrados del rango, para ver
  qué se le entregó a ese equipo.
- Tira de resumen: `N abiertos · N sin arrancar hace +Xd · N son P1 · más viejo Xd · mediana Xd`.
- Lista ordenada **por antigüedad, más viejo primero**, con la edad coloreada por umbral
  (rojo/naranja/gris). En una vista de carga lo que duele es lo parado, no lo reciente.
- Cada fila: key, chip de estado, antigüedad, título, responsable, prioridad, talla.

---

## Testing

- `shared/core/workload.test.ts` — `computeWorkload` con issues sintéticos: rango de fechas,
  bucket `null`, issue en dos boards contado dos veces, `totals.compartidos`, orden.
- `shared/core/jira.test.ts` — `mergeIssuesByBoard`: dedupe y unión de boards.
- `parseJiraIssue` — `requester` presente y ausente.
- Migración: init sobre base vieja agrega las columnas sin perder datos.
- Server: `GET /api/workload` con filtros, en `routes.test.ts`.
- Mobile: `writeSnapshots`/lectura de `workload_snapshot`, y `computeBundle` incluyendo `workload`.

---

## Riesgos y trabajo previo

1. **Backfill obligatorio.** Los 4099 issues existentes quedan con `requester` y `boards`
   en `NULL`. El sync es incremental (`board_sync.last_synced_at`), así que hay que vaciar
   `board_sync` y correr un sync completo, una sola vez. Hasta entonces la solapa muestra
   esos issues como "Sin dato" en lugar de mentir con un cero.
2. **El sync está atrasado.** Último sync 2026-08-09; hay ~3 semanas sin traer.
3. **La talla va a estar vacía en muchas filas.** Hay 456 issues sin clasificar. Es un
   problema preexistente, ajeno a esta feature, y no la bloquea.

## Fuera de alcance

- Tendencias o series temporales de la carga (solo se muestra el corte del rango elegido).
- Vista equivalente en el cliente web.
- Cualquier escritura hacia Jira.
- Limpiar el campo "Equipos de Trabajo" en Jira, o completar "Producto".
