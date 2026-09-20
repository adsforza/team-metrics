# Filtro de personas: cálculo local y multi-selección — diseño

**Fecha:** 2026-09-20
**Estado:** aprobado, listo para plan de implementación

## Problema

Dos cosas, con una causa común.

**Es lento.** En `mobile/app/(tabs)/ajustes.tsx:22-25`, elegir una persona dispara un sync
completo:

```ts
const handleSetAssignee = (id: string | null) => {
  setAssignee(id);
  sync();        // server recalcula y el celular baja 11 endpoints
};
```

El server recomputa todos los snapshots filtrados por esa persona y el celular los vuelve
a bajar. Segundos de espera para mirar datos que ya tiene.

**Solo se puede elegir una persona.** `filterStore.assignee` es `string | null` y el core
compara con `===`.

## Hallazgos que habilitan la solución

**El crudo ya está completo en el celular.** `/api/raw` se baja con un centinela de fecha
y sin filtrar por persona (`mobile/lib/sync.ts:118-123`), así que el dispositivo tiene
todos los issues, transiciones y miembros.

**El cálculo local ya existe y está en producción.** `recomputeSnapshots` en
`mobile/lib/directSync.ts` lee el crudo, corre `computeBundle` y escribe los snapshots.
Es lo que usa direct mode hoy.

**El multi-select ya está resuelto a medias.** `shared/core/scorecard.ts:57-64` tiene
`passesAssignee`, con la semántica exacta que hace falta:

```ts
function passesAssignee(i: CoreIssue, f: QueryFilter): boolean {
  if (f.assignee) return i.assignee_id === f.assignee;
  if (f.assignees !== undefined) {
    if (f.assignees.length === 0) return false;
    return i.assignee_id != null && f.assignees.includes(i.assignee_id);
  }
  return true;
}
```

Lo usa para el agregado restringido del equipo. Hay que extraerlo y extenderlo, no
inventarlo.

**Escala:** 40 miembros en `team_members`, 38 con issues asignados. Eso descarta chips
inline y obliga a un selector con búsqueda.

## Decisión de producto

Con varias personas elegidas, la solapa Equipo **filtra las filas**: muestra solo a los
seleccionados, cada uno con sus números, y la fila "Equipo" agrega únicamente a ese
subconjunto. No se combinan en una sola entidad.

El filtro se mueve de Ajustes a la **barra superior**, al lado del selector de rango, y
queda visible en todas las solapas.

---

## Arquitectura

### 1. Flujo de datos

Hoy cambiar el filtro obliga a traer datos del server. Son dos operaciones distintas que
están pegadas sin necesidad:

| operación | costo | requiere red |
|---|---|---|
| traer datos nuevos de Jira | segundos | sí |
| mirar los mismos datos con otro filtro | milisegundos | no |

Después del cambio:

```
tocás persona → recomputeSnapshots(db, filtros) → dataVersion++ → UI
```

`recomputeSnapshots` ya hace todo el trabajo. `dataVersion++` es el mecanismo que la app
usa tras cada sync para que los hooks relean. El sync contra el server queda reservado
para el botón Sync, que es cuando realmente se quieren datos nuevos.

**Efecto lateral deseado:** cambiar el filtro pasa a funcionar offline.

### 2. Core: `assignees` en vez de `assignee`

`CoreFilter` y `FilterParams` (`shared/core/types.ts:21,23`) cambian
`assignee?: string` por `assignees?: string[]`.

`passesAssignee` se extrae de `scorecard.ts` a `shared/core/filters.ts` y lo consumen los
seis módulos que hoy comparan con `===`:

| archivo | línea |
|---|---|
| `metrics.ts` | 25, 47, 54 |
| `metricsExtra.ts` | 78, 126, 151 |
| `wipRisk.ts` | 89 |
| `bottleneck.ts` | 146-147 |
| `forecast.ts` | 127-128 |
| `comparison.ts` | 94 |

En cada uno es reemplazar la comparación por una llamada al helper.

`scorecard.ts` es el único con lógica propia: filtra las filas por las personas elegidas
y su fila "Equipo" ya sabe agregar sobre un subconjunto vía `{ assignees: includedIds }`
(`scorecard.ts:295`), así que cumple la decisión de producto casi sin tocarse.

**Compatibilidad:** `assignee` singular se mantiene como alias deprecado mientras dura el
cambio, para no romper al server de golpe, y se elimina en el último paso.

### 3. Estado del filtro

`filterStore.assignee: string | null` → `assignees: string[]`. Lista vacía significa
"todos", que es el valor por defecto.

**Cuidado con la traducción al core, que usa la convención opuesta.** En `passesAssignee`
una lista vacía significa "no matchea nada" (se usa para el agregado de un equipo sin
miembros), mientras que en el store significa "sin filtro". Si se pasa `[]` derecho al
core, elegir a nadie mostraría cero datos en vez de todos.

La conversión va en un solo lugar, donde se arman los filtros para `computeBundle`:

```ts
// store: [] = sin filtro  →  core: undefined = sin filtro
const assignees = selected.length > 0 ? selected : undefined;
```

Debe haber un test de esto: store vacío → el bundle trae todos los issues.

El store está persistido en AsyncStorage bajo la clave `tm-filters`, así que hace falta
**migración**: un celular con `{ assignee: "u1" }` guardado debe abrir con
`{ assignees: ["u1"] }` y no romper. Zustand `persist` soporta `version` + `migrate`.

### 4. UI

**Botón en la barra superior**, junto a `DateRangeBar`, mostrando el estado actual:
`Todos`, el nombre si hay una sola, o `N personas`.

**Hoja inferior** al tocarlo: buscador, opción "Todos" que limpia la selección, y la lista
de miembros con checkbox. Botón "Listo" que cierra.

Reusa `Colors`, `Typography` y `Card` de `mobile/lib/theme.ts`. Sin colores nuevos.

### 5. Frescura

La cabecera muestra hoy "sync recién" / "datos de hace 16d" leyendo `lastSyncedAt`, que es
cuándo se bajaron los **snapshots**. Después de este cambio los números salen del **crudo**,
que se baja best-effort dentro de un `try/catch` (`sync.ts:118-125`).

Si ese pedido falla, la cabecera diría "recién" mientras los números son viejos. El
timestamp del último crudo exitoso ya se guarda en `board_sync` con `board_id = 0`.

**Cambio:** el indicador pasa a leer ese timestamp. No es UI nueva — es apuntar un
indicador existente a la fuente correcta, para que no mienta.

---

## Testing

**Core** (vitest, 113 verdes hoy): cada uno de los seis módulos gana casos multi-persona
— lista vacía (= todos), una persona, varias, y una persona sin issues. `passesAssignee`
se testea aislado en `shared/core/filters.test.ts`.

**Lógica del selector**: el filtrado de los 40 nombres por texto, el toggle de selección y
la etiqueta del botón van a un módulo propio, `mobile/lib/personFilter.ts`, como funciones
puras. No a `workloadView.ts`, que es específico de la solapa Carga — este filtro es global.
`@testing-library/react-native` **no funciona en este proyecto** (incompatible con el
`jest-expo` instalado: `render()` devuelve un objeto sin queries), así que no se testea
render — mismo criterio que en la solapa Carga.

**El test que importa**: que cambiar el filtro **no llame al server**. Sobre el handler,
con el cliente HTTP mockeado, afirmando cero llamadas. Es el requisito central del pedido
y el que un refactor puede romper en silencio sin que nada más falle.

**Migración del store**: que un valor persistido con el formato viejo (`{assignee}`) abra
como `{assignees:[...]}`.

## Riesgos

1. **El crudo puede estar más viejo que los snapshots.** Mitigado por el cambio de la
   sección 5; sin eso el usuario no tendría forma de notarlo.
2. **`assignee` singular sigue vivo en el server.** El endpoint `/api/*?assignee=` no se
   toca en este trabajo: el mobile deja de usarlo, el cliente web lo sigue usando.

## Fuera de alcance

- Multi-selección en el cliente web (`client/`).
- Soporte de varias personas en la API del server.
- Filtrar por persona en la solapa Carga, que se organiza por squad y equipo solicitante.
- Filtro por talla, que queda como está.
