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

## Backlog

1. **Forecasting / Monte Carlo**
   Fecha de entrega probable de lo que está en curso y "¿llegamos a esta fecha?".
   Simulación a partir del throughput histórico. Es la capa *predictiva* que hoy no existe.

2. **WIP age vs. límites + alertas tempranas**
   Avisar cuando un issue supera su edad esperada por talla, *antes* de que se vuelva un
   problema. Requiere definir edades esperadas por S/M/L/XL.

3. **Detección de cuellos de botella entre estados**
   Identificar a nivel sistema dónde se acumula el trabajo (p.ej. tiempo excesivo en
   "In Review"). Tiempo medio por estado + tamaño de cola por estado.

4. **Vista histórica / comparativa a nivel tablero**
   Esta semana vs. anterior, este sprint vs. el pasado, para todo el tablero (no solo por
   persona como hace la scorecard).

5. **Alertas accionables / SLA**
   "Este issue va a incumplir", señales de qué atender hoy. Construible sobre (2) y (3).
