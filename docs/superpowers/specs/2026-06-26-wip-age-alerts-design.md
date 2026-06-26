# WIP Age vs. Limits + Early Alerts — Design

**Fecha:** 2026-06-26
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Backlog:** ítem #1 de `docs/superpowers/ideas-backlog.md`

## Problema

El tablero detecta trabajo **estancado** (Aging WIP, por días sin movimiento contra un umbral
global fijo), pero no detecta trabajo que va **lento para su tamaño**: una S que ya lleva más de lo
que tardan casi todas las S. No hay alerta temprana antes de que se vuelva un problema.

## Objetivo

Avisar, mientras el issue sigue en curso, cuando su **edad acumulada** supera (o se acerca a) el
**cycle time esperado de su talla**, derivado de los datos. Es una señal *predictiva* y
complementaria al Aging WIP (que mide estancamiento).

## Alcance

- Un endpoint nuevo `GET /api/metrics/wip-risk`.
- Un card nuevo dedicado **"WIP en riesgo"** (separado del Aging WIP).
- Team-wide: en v1 ignora los filtros de assignee/talla/fecha del tablero. La ventana histórica
  para los límites es propia (84 días).

**Fuera de alcance (v1):** límites configurables a mano (se derivan), filtro por assignee,
alertas push/externas, y la señal de estancamiento (ya la cubre Aging WIP).

## Cálculo

Toda duración se computa en JS (`new Date`), no con `date()` de SQLite, por el offset `-0300`
(sin colon) de Jira — mismo patrón que el resto del proyecto.

Constantes: `LOOKBACK_DAYS = 84`, `MIN_SAMPLES = 5`, `RISK_RATIO = 0.7`, `BREACH_RATIO = 1.0`.

### Límite p85 por talla

Para cada talla (`S`, `M`, `L`, `XL`): `limit_days = p85` del cycle time de los issues
**completados** de esa talla, sobre la ventana de los últimos `LOOKBACK_DAYS` días terminando en
`now`. Reutiliza `getCycleTimes(db, { talla, from, to })` (de `metrics.ts`) + `percentile(85)` (de
`stats.ts`).

- `sample_count` = cantidad de cycle times usados para esa talla.
- Si `sample_count < MIN_SAMPLES` → `limit_days = null` (p85 poco confiable) y los issues en curso
  de esa talla **no se evalúan**.

### Edad del issue en curso

Población = issues **no Done/Cancelado** que ya tienen al menos un ingreso a un estado **activo**
(categoría `active` de `statusCategories.ts`), sin importar su estado actual (activo, bloqueado o en
espera). `age_days = (now − primer ingreso a estado activo) / día`. Es la misma definición de inicio
que el cycle time, para que la comparación sea justa. Issues que nunca arrancaron (solo en
todo/backlog) quedan fuera.

### Clasificación

`ratio = age_days / limit_days` (de la talla del issue):

- **excedido** (`excedido`): `ratio ≥ BREACH_RATIO` (1.0) — ya pasó el p85 de su talla.
- **en riesgo** (`en_riesgo`): `RISK_RATIO ≤ ratio < BREACH_RATIO` (0.7–1.0) — alerta temprana.
- `ratio < RISK_RATIO` → no se muestra.

Issues con `talla = null`, o cuya talla tiene `limit_days = null` → excluidos de `items`, pero
contados en `counts.sin_limite`.

`items` se ordena por `ratio` descendente.

## Endpoint y tipos

`GET /api/metrics/wip-risk` (sin parámetros en v1). Lógica en un archivo nuevo
`server/src/services/wipRisk.ts` con `getWipRisk(db, opts?: { now?: Date })` (`now` inyectable para
tests deterministas; default `new Date()`). Ruta nueva `router.get('/wip-risk', ...)` en
`server/src/routes/metrics.ts`.

Tipos en `server/src/types.ts`, re-exportados al cliente vía `client/src/lib/api.ts`:

```ts
export type WipRiskLevel = 'en_riesgo' | 'excedido';

export interface WipRiskItem {
  issue_id: string;
  title: string;
  talla: Talla;                 // no-null
  status: string;               // estado actual
  assignee_id: string | null;
  age_days: number;
  limit_days: number;
  ratio: number;
  level: WipRiskLevel;
}

export interface TallaLimit {
  talla: Talla;
  limit_days: number | null;    // null si sample_count < MIN_SAMPLES
  sample_count: number;
}

export interface WipRiskResult {
  lookbackDays: number;         // 84
  limits: TallaLimit[];         // S, M, L, XL
  items: WipRiskItem[];         // solo en_riesgo + excedido, orden ratio desc
  counts: { en_riesgo: number; excedido: number; sin_limite: number };
}
```

Cliente: `api.wipRisk() => get<WipRiskResult>('/metrics/wip-risk')`.

## Componentes (cliente)

- `hooks/useWipRisk.ts`: hace fetch de `api.wipRisk()` en mount; expone `{ result, loading }`.
- `components/WipRisk/WipRiskCard.tsx`: presentacional (props `{ result, loading }`). Renderiza:
  - Línea de conteo: `⚠ N en riesgo` (ámbar) · `● M excedidos` (rojo) · `K sin límite` (gris).
  - Tabla (top ~8, orden ratio desc): Issue (mono), Título (truncado), Talla (pill `TALLA_BG`),
    Edad (días), Límite p85 (días), y un mini-bar de `ratio` coloreado por nivel con marca del 100%.
  - Estado vacío: "Nada en riesgo para su talla 🎉".
  - Loading skeleton. `InfoTooltip` explicando edad-vs-p85, umbrales (≥70% / ≥100%) y ventana 12 sem.
- `components/WipRisk/WipRisk.tsx`: container (hook + card).
- Montaje en `client/src/App.tsx`, en una fila propia cerca del Aging WIP.

## Manejo de errores / casos borde

- **Talla sin datos suficientes** (`< MIN_SAMPLES`): `limit_days = null`; sus issues en curso van a
  `counts.sin_limite`, no a `items`.
- **Issue sin talla:** excluido de `items`, contado en `sin_limite`.
- **Sin issues en riesgo:** `items = []`, el card muestra el estado vacío; los conteos pueden ser 0.
- **`limit_days = 0`** (p85 de cycle times todos < 1h, improbable): se trata como `null` para evitar
  división por cero (no se evalúan esos issues).
- **Cycle times / batch-moves:** `getCycleTimes` ya descarta intervalos < 1 h; se reutiliza tal cual.
- **Timezone `-0300`:** edades y cycle times computados en JS.

## Testing

Nuevo `server/src/services/wipRisk.test.ts` (Vitest + better-sqlite3 en memoria, `now` inyectado):

- **Límite p85 por talla:** sembrar completados de una talla con cycle times conocidos y verificar
  el `limit_days` (p85) y el `sample_count`.
- **MIN_SAMPLES:** una talla con `< 5` completados → `limit_days = null`, y un issue en curso de esa
  talla cae en `counts.sin_limite`, no en `items`.
- **Clasificación:** sembrar un issue en curso cuya edad da `ratio ≥ 1.0` → `excedido`; otro con
  `0.7 ≤ ratio < 1.0` → `en_riesgo`; otro con `ratio < 0.7` → no aparece.
- **Edad desde el primer activo, incluso si hoy está bloqueado:** issue que entró a activo y luego
  a `Blocked` (sin Done) → su edad se mide desde el ingreso a activo, no desde el bloqueo.
- **Orden:** `items` ordenado por `ratio` desc.
- **Sin talla:** issue en curso con `talla = null` → `sin_limite`.
- **Timezone:** timestamps `-0300` sin colon computan edad sin NaN.

Test de cliente `WipRiskCard.test.tsx` con un `WipRiskResult` de fixture: renderiza la línea de
conteo, las filas con nivel (ámbar/rojo), y el estado vacío cuando `items = []`.
