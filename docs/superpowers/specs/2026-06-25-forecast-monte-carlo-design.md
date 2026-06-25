# Forecast (Monte Carlo) — Design

**Fecha:** 2026-06-25
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Backlog:** ítem #1 de `docs/superpowers/ideas-backlog.md`

## Problema

El tablero hoy es 100% descriptivo (qué pasó) y no tiene nada **predictivo**. No responde las
dos preguntas de planificación más comunes en Kanban: "¿cuándo terminamos lo que está en curso?"
y "¿cuánto entra de acá a una fecha?".

## Objetivo

Agregar un pronóstico **Monte Carlo** que responda ambas preguntas a partir del throughput
histórico real del equipo, expresando la incertidumbre como niveles de confianza (50/85/95%) en
lugar de un único número falsamente preciso.

## Alcance

- Una card nueva "Forecast (Monte Carlo)" con dos modos: **¿Cuándo?** y **¿Cuántos?**.
- Un endpoint nuevo `GET /api/metrics/forecast`.
- Es **team-wide**: ignora los filtros de `assignee`/`talla`. Su ventana histórica es propia
  (84 días) e independiente del filtro de fechas del tablero.

**Fuera de alcance:** forecast por persona o por talla; pronóstico contra fechas de sprint
(no hay datos de sprint en el modelo); persistencia/snapshot de forecasts.

## Algoritmo Monte Carlo

### Insumo histórico

Throughput **diario** de los últimos **84 días (12 semanas)** terminando hoy, reconstruido desde
`transitions` con `to_status IN ('Done','Finalizada')`, agrupado por día calendario. El resultado
es un arreglo `daily[]` de 84 enteros, **incluyendo los días en cero** (fines de semana / días sin
entregas) — eso captura la cadencia real. Todo el cálculo es en días calendario.

Igual que en el resto del proyecto, los timestamps de Jira llegan con offset `-0300` (sin colon)
que `date()`/`strftime()` de SQLite no parsean; el agrupado por día se hace en JS con `new Date(...)`
(mismo patrón que `getThroughputWeekly`).

Constantes: `LOOKBACK_DAYS = 84`, `TRIALS = 10000`, `MAX_SIM_DAYS = 730` (tope de seguridad).

### Simulación

10.000 trials, muestreando `daily[]` **con reemplazo**.

- **Modo "¿cuántos?" (horizonte = `D` días):** cada trial suma `D` muestras diarias → cantidad
  completada. Se juntan los 10.000 conteos.
- **Modo "¿cuándo?" (items = `N`):** cada trial saca muestras diarias acumulando hasta llegar a
  `≥ N`, contando los días; si supera `MAX_SIM_DAYS` se corta en ese valor. Se juntan los 10.000
  conteos de días.

### Percentiles y su lectura

Se reportan siempre **50 / 85 / 95% de confianza**, apuntando a colas opuestas según el modo:

| Modo | conf50 | conf85 | conf95 | Lectura |
|---|---|---|---|---|
| **¿Cuándo?** | p50 de días | p85 de días | p95 de días | "termina **para** esta fecha con X% de confianza" — más confianza → fecha más tardía |
| **¿Cuántos?** | p50 del conteo | **p15** del conteo | **p5** del conteo | "completás **al menos** N con X% de confianza" — más confianza → menos items |

Esto es lo correcto estadísticamente: para "cuántos", un compromiso seguro compromete *menos*;
para "cuándo", una fecha segura es *más tardía*. Reutiliza el helper `percentile` de
`server/src/services/stats.ts` (espera el arreglo ordenado).

Para "¿cuándo?", `days` se redondea hacia arriba (`Math.ceil`) y `date = hoy + days` en formato
`YYYY-MM-DD`.

### Histograma

Para graficar, cada modo devuelve `histogram: { x: number; count: number }[]`: ~20 bins de igual
ancho cubriendo el **90% central** de la distribución (de p5 a p95), donde `x` es el valor
representativo del bin (días o cantidad) y `count` la frecuencia de trials en ese bin.

### Datos insuficientes

Si `sum(daily) === 0` (nada se completó en 84 días) no se puede pronosticar: `insufficientData =
true` y `when`/`howMany` son `null`.

## Endpoint y tipos

`GET /api/metrics/forecast?items=N&horizon=D` (ambos opcionales).

- `items` default = **WIP actual** (mismo cálculo que el KPI de WIP en `getKPIs`: issues con
  `status NOT IN ('Done','Finalizada','Cancelled','Cancelado','To Do','Tareas por hacer',
  'Backlog','Por Hacer')`). Clamp a `[1, 1000]`; inválido → default.
- `horizon` default = `14`. Clamp a `[1, 365]`; inválido → default.

Lógica en un archivo nuevo `server/src/services/forecast.ts` (`getForecast(db, { items, horizon })`),
aislada de `metrics.ts`. Ruta nueva `router.get('/forecast', ...)` en `server/src/routes/metrics.ts`.

Tipos en `server/src/types.ts`, re-exportados al cliente vía `client/src/lib/api.ts`:

```ts
export interface ForecastConfidenceDate { days: number; date: string }
export interface ForecastBin { x: number; count: number }

export interface ForecastWhen {
  conf50: ForecastConfidenceDate;
  conf85: ForecastConfidenceDate;
  conf95: ForecastConfidenceDate;
  histogram: ForecastBin[];
}

export interface ForecastHowMany {
  conf50: number;  // items (≥)
  conf85: number;
  conf95: number;
  histogram: ForecastBin[];
}

export interface ForecastResult {
  items: number;             // eco del input usado para "cuándo" (default WIP)
  horizonDays: number;       // eco del input usado para "cuántos" (default 14)
  lookbackDays: number;      // 84
  trials: number;            // 10000
  totalThroughput: number;   // total completado en la ventana
  insufficientData: boolean;
  when: ForecastWhen | null;
  howMany: ForecastHowMany | null;
}
```

Cliente: `api.forecast({ items?, horizon? }) => get<ForecastResult>('/metrics/forecast', ...)`.

## Componentes (cliente)

- `hooks/useForecast.ts`: mantiene `mode` (`'when' | 'howMany'`), `items`, `horizon`; consulta
  `api.forecast` con **debounce ~400 ms** al cambiar el input; expone `{ forecast, loading }`.
  Valor inicial de `items` = `undefined` (el server precarga el WIP y lo devuelve en `items`, que
  el input adopta en la primera respuesta).
- `components/Forecast/Forecast.tsx`: card con toggle de modo (segmented `¿Cuándo?` / `¿Cuántos?`),
  input editable según modo, los tres resultados 50/85/95% con microcopy de dirección, estados de
  `insufficientData` y loading, e `InfoTooltip` explicando el método.
- `components/Forecast/ForecastHistogram.tsx`: BarChart de Recharts con la distribución y líneas
  verticales (`ReferenceLine`) en P50/P85/P95.
- Montaje en `client/src/App.tsx`, en una fila propia debajo de Throughput/Aging.

## Manejo de errores / casos borde

- **Sin histórico:** `insufficientData=true` → la card muestra "Sin suficiente histórico para
  pronosticar (se necesitan entregas en las últimas 12 semanas)". `when`/`howMany` = `null`.
- **`items` muy grande con throughput bajo:** el trial se corta en `MAX_SIM_DAYS` (730);
  la fecha resultante se muestra tal cual (efectivamente "> 2 años").
- **Inputs inválidos / fuera de rango:** se clampan; el server devuelve el valor efectivamente
  usado en `items`/`horizonDays` y el cliente refleja ese eco.
- **Histograma con rango degenerado** (p5 == p95, p.ej. distribución muy concentrada): un único
  bin con todo el conteo.
- **Timezone Jira `-0300`:** agrupado por día en JS, nunca con `date()` de SQLite.

## Testing

Nuevo `server/src/services/forecast.test.ts` (Vitest + better-sqlite3 en memoria):

- **Throughput diario:** siembra Done en días conocidos (incluido un timestamp `-0300`) y verifica
  que `daily[]` los cuenta en el día correcto sin NaN.
- **Determinismo de la simulación:** con un `daily[]` constante (p.ej. exactamente 1/día todos los
  días), el modo "¿cuándo?" para `N` items da ~`N` días en los tres percentiles, y "¿cuántos?" en
  `D` días da ~`D`. (Tolerancia chica; o inyectar un RNG sembrado — ver nota abajo.)
- **Dirección de percentiles:** con throughput variable, en "¿cuándo?" `conf95.days >= conf85.days
  >= conf50.days`; en "¿cuántos?" `conf95 <= conf85 <= conf50`.
- **Datos insuficientes:** sin Done en 84 días → `insufficientData=true`, `when`/`howMany` null.
- **Default de items:** sin `items` en la query, usa el WIP actual (sembrar issues activos y
  verificar el eco `items`).
- **Clamps:** `items=0`/`horizon=0`/negativos/enormes → valores clampeados en el eco.

Nota de testabilidad: `getForecast` acepta un parámetro opcional `rng: () => number` (default
`Math.random`) para inyectar un generador determinista en los tests y evitar flakiness.

Tests de cliente: `Forecast.test.tsx` (render de los 3 percentiles en cada modo, toggle de modo,
estado `insufficientData`) con un `ForecastResult` de fixture.
