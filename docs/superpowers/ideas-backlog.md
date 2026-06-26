# Backlog de ideas — TeamMetrics

Ideas de funcionalidades/insights identificadas durante el brainstorming del 2026-06-19.
Cada una es una feature independiente con su propio ciclo spec → plan cuando se encare.

## Entregado

- **Team Performance Scorecard** — ✅ entregado (mergeado a `main` el 2026-06-20).
  Reemplaza el score `A/B/C/D` por 4 señales multidimensionales (Entrega, Predecibilidad,
  Foco, Flujo) vs. el propio historial, con fila agregada "Equipo" y banda de contexto
  (mediana, no ranking). Incluye: filtro por talla, exclusión de miembros sin datos en los
  4 indicadores, y orden por click en el encabezado (alfabético por defecto).
  La dimensión **Flujo** cubre *flow efficiency* (tiempo activo vs. espera).
  Spec: `docs/superpowers/specs/2026-06-19-team-performance-scorecard-design.md`.
  Plan: `docs/superpowers/plans/2026-06-20-team-performance-scorecard.md`.

- **Forecast (Monte Carlo)** — ✅ entregado (mergeado a `main` el 2026-06-25).
  Card con dos modos: "¿Cuándo?" (días/fecha para completar N issues, default = WIP) y
  "¿Cuántos?" (issues en D días, default 14), como percentiles 50/85/95 de confianza más un
  histograma de la distribución. 10.000 trials sobre el throughput diario de las últimas 12
  semanas. Endpoint `GET /api/metrics/forecast`. Es la capa *predictiva* que faltaba.
  Spec: `docs/superpowers/specs/2026-06-25-forecast-monte-carlo-design.md`.
  Plan: `docs/superpowers/plans/2026-06-25-forecast-monte-carlo.md`.

## Backlog

1. **WIP age vs. límites + alertas tempranas**
   Avisar cuando un issue supera su edad esperada por talla, *antes* de que se vuelva un
   problema. Requiere definir edades esperadas por S/M/L/XL.

2. **Detección de cuellos de botella entre estados**
   Identificar a nivel sistema dónde se acumula el trabajo (p.ej. tiempo excesivo en
   "In Review"). Tiempo medio por estado + tamaño de cola por estado.

3. **Vista histórica / comparativa a nivel tablero**
   Esta semana vs. anterior, este sprint vs. el pasado, para todo el tablero (no solo por
   persona como hace la scorecard).

4. **Alertas accionables / SLA**
   "Este issue va a incumplir", señales de qué atender hoy. Construible sobre (1) y (2).
