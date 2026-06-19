# Team Performance Scorecard — Design

**Fecha:** 2026-06-19
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

El tablero hoy evalúa a cada persona con un único score `A/B/C/D` asignado **por cuartil**
(`weightedThroughput / cycleTimeP50`, ver `server/src/services/metrics.ts:237`). Para una
audiencia **mixta (equipo + lead)** esto es dañino:

- Es un **ranking forzado**: siempre hay un "D" aunque todo el equipo sea excelente, y siempre
  un "A" aunque todos vayan flojos. Genera competencia tóxica.
- Premia **volumen/velocidad**, que es fácil de "jugar" (partir tareas, evitar las difíciles).
- Colapsa todo en una letra: no muestra *en qué* mejorar, que es lo que sirve para un 1:1.

## Objetivo

Reemplazar la letra única por **4 señales multidimensionales**, cada una mostrada como
**tendencia de la persona contra su propio historial**, con la mediana del equipo solo como
**contexto** (nunca como ranking). Debe servir tanto para los 1:1s del lead como para que el
equipo lo vea sin sentirse rankeado.

**Fuera de alcance (próxima iteración):** la vista detalle expandible por persona (mini-gráficos
de 6–8 semanas por dimensión). Esta iteración entrega la **tabla compacta + agregado de equipo**.

## Las 4 dimensiones

Todas se calculan por persona dentro del rango `[from, to]` seleccionado. Los timestamps de Jira
llegan con offset `-0300` (sin dos puntos), que `date()`/`julianday()` de SQLite no parsean
(devuelven NULL) — por eso **toda duración se calcula en JS**, siguiendo el patrón ya establecido
en `getCycleTimes`, `getAgingWIP` y `getThroughputWeekly`.

| Dimensión | Mide | Cálculo | Mejor |
|---|---|---|---|
| **Entrega** (`delivery`) | Valor completado | Throughput ponderado por talla (`S=1, M=2, L=4, XL=8`) de issues que llegaron a `Done` en el rango | ↑ más alto |
| **Predecibilidad** (`predictability`) | Consistencia del cycle time | Ratio `p85 / p50` de cycle times de los issues completados en el rango | ↓ más cerca de 1 |
| **Foco** (`focus`) | Dispersión / multitarea | WIP concurrente promedio: muestreo diario del nº de issues de la persona en estado **activo** al cierre de cada día del rango, promediado | ↓ más bajo |
| **Flujo** (`flow`) | Tiempo que el trabajo avanza vs. espera | Flow efficiency: mediana, sobre los issues completados, de `tiempo_en_estados_activos / cycle_time_total`. Se reporta como % | ↑ más alto |

### Clasificación canónica de estados

Se centraliza el mapeo de estados (hoy duplicado en varios lugares de `metrics.ts`) en un único
helper reutilizable:

- **TODO / Backlog:** `To Do`, `Tareas por hacer`, `Backlog`, `Por Hacer`
- **WAITING (en cola, no activo):** `Ready for Development`, `Prioritized`, `Committed`,
  `Prioritization`, `Ready for deploy`
- **ACTIVE:** `In Progress`, `IN PROGRESS`, `EN CURSO`, `In development`
- **BLOCKED:** `Blocked`
- **DONE:** `Done`, `Finalizada`
- **CANCELLED:** `Cancelled`, `Cancelado`

Para **Flujo**: `activo = ACTIVE`; `espera = WAITING + BLOCKED` (tiempo dentro del WIP sin avanzar).
Para **Foco**: cuenta solo estados `ACTIVE`.
Cycle time arranca en el primer ingreso a `ACTIVE` y termina en `DONE` (igual que hoy), descartando
intervalos < 1 hora (batch-moves), reutilizando la lógica existente.

## Tendencia y contexto

**Tendencia (▲ ▼ =):** se recalcula cada dimensión sobre la **ventana inmediatamente anterior de
igual longitud** (`[from - (to-from), from]`) y se compara.

- `trend` = dirección cruda del cambio (`up` / `down` / `flat`). `flat` si el cambio relativo es
  ≤ 5% o si no hay datos en la ventana anterior.
- `improving` = lectura **consciente de la polaridad** de la dimensión (`better` / `worse` /
  `steady`), que es lo que **define el color**: verde = mejora, ámbar = empeora, gris = estable.
  - Entrega y Flujo: subir = `better`.
  - Predecibilidad y Foco: bajar = `better`.

La **flecha** muestra la dirección; el **color** muestra si esa dirección es buena. Así nadie queda
pintado de "rojo perdedor" por su posición — solo por su propia tendencia.

**Barra de contexto (mediana del equipo):** por dimensión se calcula `{min, median, max}` del equipo
en la ventana actual. El relleno de la barra ubica el valor de la persona normalizado en `[min, max]`;
una marca señala la posición de la mediana. Es contexto visual, sin letras ni puestos.

## UI — Opción A (aprobada)

La `TeamTable` **evoluciona** (no se crea pantalla nueva): se reemplaza la columna `A/B/C/D` por
4 columnas de dimensión. Cada celda = **valor + flecha de tendencia + barra de contexto** (con la
marca de la mediana del equipo).

- Una **fila de agregado de equipo** arriba (gris) muestra las 4 dimensiones a nivel sistema con su
  tendencia: responde "¿cómo viene el equipo?" antes de mirar personas.
- Color por **tendencia/mejora**, no por posición.
- Los encabezados de cada dimensión usan el componente `InfoTooltip` (ya presente, sin commitear)
  para explicar qué mide y cómo leerla.

Boceto de referencia: `.superpowers/brainstorm/2691-1781900365/content/scorecard-layout.html`
(Opción A).

## Cambios de API y tipos

`GET /api/team` cambia su contrato de respuesta (cambio intencional y aceptado; el cliente local se
actualiza en el mismo trabajo). Pasa de `PersonMetrics[]` a:

```ts
type Trend = 'up' | 'down' | 'flat';
type Improving = 'better' | 'worse' | 'steady';

interface DimensionValue {
  value: number | null;       // null = datos insuficientes
  previous: number | null;    // ventana anterior, para tendencia
  trend: Trend;               // dirección cruda
  improving: Improving;       // polaridad → color
}

interface PersonScorecard {
  member: TeamMember;
  delivery: DimensionValue;
  predictability: DimensionValue;
  focus: DimensionValue;
  flow: DimensionValue;
}

interface DimensionContext { min: number; median: number; max: number }

interface TeamScorecardResponse {
  team: { delivery: DimensionValue; predictability: DimensionValue;
          focus: DimensionValue; flow: DimensionValue };
  members: PersonScorecard[];
  context: { delivery: DimensionContext; predictability: DimensionContext;
             focus: DimensionContext; flow: DimensionContext };
}
```

- Se **elimina** el cálculo de score por cuartil de `getTeamMetrics` y el uso del tipo `Score` allí.
- Se conserva el soporte de filtros existente (`from/to/assignee/talla/status`).

## Componentes (cliente)

- `TeamTable.tsx`: reemplaza la columna de score por las 4 columnas de dimensión + fila de agregado.
- Nuevo `DimensionCell` (dentro de `TeamTable/`): renderiza valor + flecha + barra de contexto a
  partir de un `DimensionValue` y su `DimensionContext`.
- `useTeam.ts`: adapta el hook al nuevo shape de respuesta.
- `InfoTooltip`: se reutiliza en los encabezados de dimensión.

## Manejo de errores / casos borde

- **Datos insuficientes:** < 2 issues completados → `predictability` y `flow` = `null` → la celda
  muestra "—". `delivery` y `focus` pueden ser 0 legítimamente.
- **Sin ventana anterior** (rango al inicio del histórico): `trend='flat'`, `improving='steady'`.
- **Persona sin actividad:** las 4 dimensiones en `null`/0, fila atenuada.
- **Cycle time 0 / batch-moves:** filtrados (< 1 h) reutilizando la lógica actual; evita división
  por cero en flow efficiency.
- **Normalización de barra con `min==max`:** relleno al 50%, marca de mediana al 50%.

## Testing (TDD)

Nuevo `server/src/services/metrics.test.ts` con una DB SQLite en memoria sembrada con `transitions`
sintéticas que cubra, por dimensión:

- **Entrega:** ponderación por talla correcta; cuenta solo `Done` dentro del rango.
- **Predecibilidad:** ratio `p85/p50`; `null` con < 2 completados.
- **Foco:** WIP concurrente promedio con solapamientos conocidos.
- **Flujo:** flow efficiency con tramos activos vs. bloqueados conocidos; mediana correcta.
- **Tendencia:** `trend` e `improving` con polaridad correcta por dimensión; `flat/steady` sin
  ventana previa.
- **Contexto:** `{min, median, max}` del equipo; caso `min==max`.
- **Timezone:** timestamps con offset `-0300` sin colon se computan en JS sin NULLs.

Test de cliente para `DimensionCell` (mapeo valor/flecha/color) y para el render de la fila de
agregado.
