# TeamMetrics — Diseño técnico
**Fecha:** 2026-06-08  
**Proyecto:** team-metrics  
**Stack:** React + Express + SQLite  

---

## 1. Visión general

Tablero local de métricas Kanban para un equipo de DevOps. Lee issues de Jira Cloud vía API, los guarda en SQLite con un job periódico, y los enriquece con una clasificación de complejidad (S/M/L/XL) asignada automáticamente por la API de Claude. El frontend React lee siempre del cache local.

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React + Recharts)  :5173                 │
│  - Filtros: período, persona, talla, estado         │
│  - Lee /api/* del backend local                     │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost)
┌──────────────────▼──────────────────────────────────┐
│  Backend (Express)  :3001                           │
│  - GET /api/issues       → issues filtrados         │
│  - GET /api/metrics      → KPIs calculados          │
│  - GET /api/team         → métricas por persona     │
│  - POST /api/sync        → dispara sync manual      │
│                                                     │
│  Sync Job (node-cron, cada 30 min)                  │
│  1. Fetch issues de Jira Cloud API                  │
│  2. Por cada issue nuevo: llama Claude API → talla  │
│  3. Upsert en SQLite                                │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  SQLite  (data/kanban.db)                           │
│  - issues, transitions, team_members                │
└─────────────────────────────────────────────────────┘
                   │ Jira Cloud API (HTTPS)
                   │ Claude API (HTTPS)
```

---

## 3. Schema de base de datos

### `issues`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | Key de Jira (ej: OPS-312) |
| `title` | TEXT | Resumen del issue |
| `description` | TEXT | Descripción completa |
| `status` | TEXT | Estado actual (To Do, In Progress, In Review, In QA, Done, Blocked) |
| `assignee_id` | TEXT FK | ID del miembro del equipo |
| `talla` | TEXT | S / M / L / XL (asignado por IA) |
| `talla_confidence` | REAL | Score de confianza 0–1 devuelto por Claude |
| `created_at` | TEXT | ISO timestamp de creación en Jira |
| `updated_at` | TEXT | ISO timestamp de última actualización |
| `synced_at` | TEXT | ISO timestamp de última sincronización local |
| `last_transition_at` | TEXT | ISO timestamp del último cambio de estado (desnormalizado para Aging WIP) |

### `transitions`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | — |
| `issue_id` | TEXT FK | — |
| `from_status` | TEXT | Estado origen |
| `to_status` | TEXT | Estado destino |
| `transitioned_at` | TEXT | ISO timestamp del cambio |

> Las transiciones permiten calcular cycle time real (tiempo entre primer "In Progress" y "Done") e identificar issues sin movimiento (aging WIP).

### `team_members`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | Account ID de Jira |
| `display_name` | TEXT | Nombre visible |
| `email` | TEXT | Email |
| `avatar_url` | TEXT | URL del avatar de Jira |

### `sync_log`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | — |
| `started_at` | TEXT | ISO timestamp de inicio del sync |
| `finished_at` | TEXT | ISO timestamp de fin |
| `synced_count` | INTEGER | Issues procesados |
| `classified_count` | INTEGER | Issues clasificados por IA en este sync |
| `error` | TEXT | Mensaje de error si falló, NULL si OK |

---

## 4. Clasificación de complejidad con IA

Al sincronizar un issue nuevo (o uno cuya descripción cambió), el backend llama a Claude con el siguiente prompt:

```
Sos un experto en DevOps. Clasificá la complejidad de este issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON: {"talla": "M", "confidence": 0.85, "razon": "..."}

Issue: {{title}}
Descripción: {{description}}
```

El backend guarda `talla` y `talla_confidence` en SQLite. Si `confidence < 0.6`, se guarda `talla = null` y se muestra como "sin clasificar" en el frontend.

---

## 5. Cálculo de métricas

Todas las métricas se calculan en el backend sobre los datos de SQLite.

### Cycle time
- **Inicio:** timestamp del primer transition a `In Progress`
- **Fin:** timestamp del transition a `Done`
- Se calcula por issue completado. Issues sin `Done` no cuentan.
- **p50 / p85:** percentiles calculados sobre el array de cycle times del período filtrado.

### Throughput
- Count de issues con transition a `Done` dentro del rango de fechas, agrupados por semana.

### WIP actual
- Count de issues cuyo `status` actual NO es `Done` o `To Do`.

### Aging WIP
- Issues con `status != Done`, ordenados por `(now - last_transition_at)` descendente.

### Score de rendimiento por persona
- Calculado como: `(throughput × peso_talla) / cycle_time_normalizado`
- `peso_talla`: S=1, M=2, L=4, XL=8
- Normaliza el throughput bruto por complejidad, luego penaliza por cycle time vs. promedio del equipo.
- Se mapea a letra: A (top 25%), B (25–50%), C (50–75%), D (bottom 25%).

---

## 6. API del backend

Todos los endpoints aceptan query params: `?from=ISO&to=ISO&assignee=id&talla=S,M,L,XL&status=In+Progress,Done`.

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/issues` | Lista de issues filtrados |
| `GET` | `/api/metrics` | KPIs: wip, throughput, cycle_time_p50, cycle_time_p85, blocked_count |
| `GET` | `/api/metrics/by-talla` | Cycle time p50 desglosado por S/M/L/XL |
| `GET` | `/api/metrics/cfd` | Datos del CFD: `[{date, todo, in_progress, in_review, done}]` |
| `GET` | `/api/metrics/throughput` | Throughput semanal: `[{week, count, by_talla}]` |
| `GET` | `/api/metrics/aging` | Issues aging: `[{issue_id, title, talla, status, days_in_status}]` |
| `GET` | `/api/team` | Métricas por persona: throughput, ct_p50, mix_tallas, blocked, score |
| `GET` | `/api/team/members` | Lista de miembros del equipo |
| `POST` | `/api/sync` | Dispara sync manual. Responde `{status, synced_count, classified_count}` |
| `GET` | `/api/sync/status` | Estado del último sync: timestamp, error si hubo |

---

## 7. Frontend — estructura de componentes

```
src/
├── App.tsx                   # Router + layout principal
├── components/
│   ├── Header/
│   │   ├── Header.tsx        # Barra con todos los filtros
│   │   ├── TimeRangePicker.tsx
│   │   ├── PersonFilter.tsx
│   │   ├── TallaFilter.tsx
│   │   └── StatusFilter.tsx
│   ├── KPICards/
│   │   └── KPICards.tsx      # 4 tarjetas: WIP, throughput, CT, bloqueados
│   ├── CycleTimeByTalla/
│   │   └── CycleTimeByTalla.tsx   # 4 cards S/M/L/XL con comparación vs equipo
│   ├── CFDChart/
│   │   └── CFDChart.tsx      # Cumulative Flow Diagram (AreaChart de Recharts)
│   ├── ScatterPlot/
│   │   └── ScatterPlot.tsx   # Cycle time scatter coloreado por talla
│   ├── ThroughputChart/
│   │   └── ThroughputChart.tsx    # BarChart apilado por talla
│   ├── AgingWIP/
│   │   └── AgingWIP.tsx      # Tabla de issues sin movimiento
│   └── TeamTable/
│       └── TeamTable.tsx     # Comparativa del equipo con score
├── hooks/
│   ├── useFilters.ts         # Estado global de filtros (Zustand o Context)
│   ├── useMetrics.ts         # Fetcher de /api/metrics
│   └── useTeam.ts            # Fetcher de /api/team
└── lib/
    ├── api.ts                # Cliente HTTP hacia el backend
    └── formatters.ts         # Helpers: formatDays, formatDate, tallaColor
```

---

## 8. Estructura de carpetas del proyecto

```
team-metrics/
├── client/                  # React app (Vite)
│   ├── src/
│   └── package.json
├── server/                  # Express backend
│   ├── src/
│   │   ├── index.ts         # Entry point, monta rutas
│   │   ├── routes/          # Un archivo por grupo de rutas
│   │   ├── services/
│   │   │   ├── jira.ts      # Cliente Jira Cloud API
│   │   │   ├── claude.ts    # Clasificación de talla con Claude API
│   │   │   ├── sync.ts      # Lógica del job de sincronización
│   │   │   └── metrics.ts   # Consultas y cálculos de métricas
│   │   └── db/
│   │       ├── schema.ts    # Definición de tablas (better-sqlite3)
│   │       └── migrations/  # Migraciones SQL versionadas
│   └── package.json
├── data/                    # SQLite DB (gitignored)
├── docs/
│   └── superpowers/specs/
├── .env.example             # Plantilla de variables de entorno
└── package.json             # Scripts raíz (dev, build, sync)
```

---

## 9. Variables de entorno

```bash
# .env
JIRA_BASE_URL=https://tu-dominio.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=OPS
JIRA_BOARD_ID=123

CLAUDE_API_KEY=...
CLAUDE_MODEL=claude-haiku-4-5   # modelo barato para clasificación masiva

SYNC_INTERVAL_MINUTES=30
AGING_THRESHOLD_DAYS=7          # días sin moverse para marcar como bloqueado
```

---

## 10. Flujo de sincronización

```
node-cron dispara cada SYNC_INTERVAL_MINUTES
  │
  ├─ GET /rest/agile/1.0/board/{id}/issue   (Jira API, paginado)
  │    └─ funciona para boards Kanban y Scrum; filtra por updatedDate > last_sync_at
  │
  ├─ Por cada issue:
  │    ├─ Fetch changelog (transiciones de estado)
  │    ├─ Si es nuevo o descripción cambió → llama Claude API → talla
  │    └─ Upsert en issues + transitions
  │
  └─ Actualiza sync_log (timestamp, contadores, errores)
```

---

## 11. Decisiones técnicas

| Decisión | Elección | Razón |
|---|---|---|
| ORM | `better-sqlite3` directo | Sync API, sin overhead, queries explícitos |
| Estado frontend | Zustand | Liviano, sin boilerplate de Redux |
| Gráficos | Recharts | Composable, bien integrado con React |
| Clasificación IA | `claude-haiku-4-5` | Rápido y barato para clasificar issues en batch |
| Styling | Tailwind CSS | Utilidades, sin CSS custom complejo |
| Runtime | Node.js 20 LTS | Compatible con `better-sqlite3` |

---

## 12. Lo que queda fuera del alcance (v1)

- Autenticación/multi-usuario
- Exportación a CSV/PDF
- Notificaciones (Slack, email) por aging WIP
- Soporte para múltiples boards al mismo tiempo
- Edición manual de talla (override del valor de IA)
