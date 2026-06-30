# TeamMetrics Mobile — Diseño

## Objetivo

App nativa iOS + Android que replica el dashboard web de TeamMetrics con datos locales (SQLite embebido) sincronizados manualmente desde el servidor Express. El endpoint del servidor es configurable para soportar tanto WiFi local como un servidor con IP pública en el futuro.

## Arquitectura

El proyecto vive en `mobile/` en la raíz del monorepo como un proyecto Expo independiente. No comparte `node_modules` con `server/` ni `client/`, pero reutiliza los mismos tipos TypeScript (copiados/compartidos manualmente o via referencia de ruta relativa).

```
team-metrics/
├── server/          # Express :3001 (sin cambios)
├── client/          # React web :5173 (sin cambios)
└── mobile/          # Nuevo — proyecto Expo
    ├── app/         # Expo Router (file-based routing)
    │   ├── (tabs)/
    │   │   ├── index.tsx       # Inicio
    │   │   ├── equipo.tsx      # Equipo
    │   │   ├── issues.tsx      # Issues
    │   │   ├── analisis.tsx    # Análisis
    │   │   └── ajustes.tsx     # Ajustes
    │   └── _layout.tsx
    ├── components/  # Componentes por pantalla
    ├── hooks/       # useMetrics, useTeam, useSync, etc.
    ├── store/       # Zustand stores
    ├── lib/
    │   ├── db.ts    # expo-sqlite helpers
    │   ├── sync.ts  # lógica de fetch + escritura en SQLite
    │   └── types.ts # tipos copiados de server/src/types.ts
    └── package.json
```

## Stack técnico

| Capa | Librería | Versión |
|---|---|---|
| Framework | Expo SDK 52 + TypeScript | ~52.x |
| Routing | Expo Router | ~4.x |
| UI components | `@chakra-ui/native` | latest |
| Iconos | `@expo/vector-icons` (Feather) | incluido en Expo |
| Gráficos | Victory Native XL (Skia) | ~41.x |
| Estado global | Zustand | ~5.x |
| Base de datos local | `expo-sqlite` | ~14.x |
| Persistencia settings | `@react-native-async-storage/async-storage` | ~2.x |

## Modelo de datos local (SQLite)

La app mantiene un snapshot de cada endpoint en tablas locales. El sync sobreescribe todo (no es incremental).

```sql
-- KPIs y métricas básicas (un solo row, reemplazado en cada sync)
CREATE TABLE kpi_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1,
  wip INTEGER,
  throughput INTEGER,
  cycle_time_p50 REAL,
  cycle_time_p85 REAL,
  blocked_count INTEGER,
  synced_at TEXT
);

-- Throughput semanal (reemplazado en cada sync)
CREATE TABLE throughput_weekly (
  week TEXT PRIMARY KEY,
  count INTEGER,
  by_talla TEXT  -- JSON
);

-- Scorecard por persona
CREATE TABLE scorecard_members (
  member_id TEXT PRIMARY KEY,
  member_json TEXT,  -- JSON del PersonScorecard completo
  synced_at TEXT
);

-- Issues en aging / WIP
CREATE TABLE aging_issues (
  issue_id TEXT PRIMARY KEY,
  title TEXT, talla TEXT, status TEXT,
  days_in_status INTEGER, assignee_id TEXT
);

-- WIP Risk
CREATE TABLE wip_risk_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1,
  result_json TEXT,  -- JSON del WipRiskResult completo
  synced_at TEXT
);

-- Bottleneck
CREATE TABLE bottleneck_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1,
  result_json TEXT,
  synced_at TEXT
);

-- Forecast
CREATE TABLE forecast_snapshot (
  id INTEGER PRIMARY KEY DEFAULT 1,
  result_json TEXT,
  synced_at TEXT
);

-- Comparativa semanal
CREATE TABLE comparison_snapshot (
  week TEXT PRIMARY KEY,
  result_json TEXT,
  synced_at TEXT
);

-- Issues (para scatter plot)
CREATE TABLE issues_snapshot (
  issue_id TEXT PRIMARY KEY,
  title TEXT, status TEXT, talla TEXT,
  assignee_id TEXT, ct_days REAL,
  last_transition_at TEXT, created_at TEXT
);

-- CFD
CREATE TABLE cfd_points (
  date TEXT PRIMARY KEY,
  todo INTEGER, in_progress INTEGER,
  in_review INTEGER, in_qa INTEGER, done INTEGER
);
```

## Sync

```
[Usuario toca "Sync"]
        ↓
Lee baseUrl desde AsyncStorage (default: http://192.168.1.X:3001)
        ↓
Fetch en paralelo de todos los endpoints:
  GET /api/metrics         → kpi_snapshot
  GET /api/metrics/throughput → throughput_weekly
  GET /api/team            → scorecard_members
  GET /api/metrics/aging   → aging_issues
  GET /api/metrics/wip-risk → wip_risk_snapshot
  GET /api/metrics/bottleneck → bottleneck_snapshot
  GET /api/metrics/forecast → forecast_snapshot
  GET /api/metrics/comparison → comparison_snapshot
  GET /api/metrics/cfd     → cfd_points
  GET /api/issues          → issues (para scatter plot cycle time)
        ↓
Escribe resultados en SQLite (transacción, reemplaza todo)
        ↓
Actualiza `last_synced_at` en AsyncStorage
        ↓
Zustand store emite evento → todas las pantallas re-renderizan
```

**Manejo de errores:** Si algún endpoint falla, el sync muestra un toast de error con el detalle y mantiene los datos anteriores intactos. No falla silenciosamente.

**Sin sync automático:** El sync es siempre manual. No hay background fetch ni polling.

## Pantallas

### Tab 1 — Inicio

Muestra el estado del tablero de un vistazo.

**Contenido:**
- 4 KPI cards en grilla 2×2: WIP, Throughput (semana), Cycle Time P50, Bloqueados
- Widget comparativa semanal: throughput y WIP esta semana vs. anterior con delta coloreado
- Gráfico de barras throughput semanal (últimas 6 semanas) — Victory Native `VictoryBar`

**Filtros:** ninguno (es la vista de todo el tablero)

### Tab 2 — Equipo

Scorecard de performance por persona.

**Contenido:**
- Selector de persona (dropdown, default: "Todos")
- Tabla con fila "Equipo" primero, luego una fila por miembro
- Columnas: Persona, Entrega, Predecibilidad, Foco, Flujo
- Cada celda muestra ↑ / → / ↓ con color (verde/amarillo/rojo)
- Al tocar una fila: sheet modal con el detalle de esa persona (valores numéricos, comparación vs. período anterior)

**Filtros:** por persona (filtra la fila o hace scroll hasta ella)

### Tab 3 — Issues

Lista de issues que necesitan atención.

**Contenido:**
- Sección "WIP en riesgo": cards con issue, talla, días actuales vs. límite, barra de progreso, badge `en_riesgo` / `excedido`
- Sección "Aging WIP": lista de issues sin movimiento, días en status actual, assignee
- Ambas secciones con contador en el header de sección

**Filtros:** por persona y por talla (dropdowns en el header de la pantalla)

### Tab 4 — Análisis

Visualizaciones avanzadas de flujo y predicción.

**Contenido (scroll vertical):**
1. **Cuello de botella** — lista de estados con barra de saturación, badge de severidad (crítico/alto/medio/normal), issues top por estado
2. **Forecast Monte Carlo** — toggle ¿Cuándo? / ¿Cuántos?, percentiles P50/P85/P95, histograma de distribución (`VictoryBar`)
3. **CFD** — gráfico de área apilada por estado (últimas N semanas) — `VictoryStack` + `VictoryArea`
4. **Scatter plot cycle time** — puntos por issue, eje X = fecha, eje Y = días — `VictoryScatter`

**Filtros:** por talla (afecta forecast y scatter)

### Tab 5 — Ajustes

Configuración del servidor y sync.

**Contenido:**
- **Servidor**: campo de texto editable con la URL base (guardado en AsyncStorage al perder foco). Placeholder: `http://192.168.1.X:3001`.
- **Sincronización**: botón "Sincronizar ahora", texto "Última sync: [fecha hora]" o "Nunca sincronizado". Spinner durante el proceso.
- **Filtros globales**: selector de persona y talla que se aplican a todas las pantallas. Persisten en AsyncStorage entre sesiones.

## Logo y branding

**Concepto:** Kanban Flow — tres columnas verticales de altura ascendente (izq: gris/todo, centro: azul/doing, der: azul claro/done), conectadas por flechas pequeñas que indican el flujo.

**Paleta:**
- Primario: `#3182CE` (Chakra blue.500)
- Secundario: `#63B3ED` (Chakra blue.300)
- Neutro: `#4A5568` (Chakra gray.600)
- Fondo app: `#0f172a` (slate-900, consistente con web)

**Wordmark:** "Team" en blanco + "Metrics" en `#3182CE`, sans-serif semibold.

**Archivos a generar:** `mobile/assets/icon.png` (1024×1024), `mobile/assets/adaptive-icon.png` (Android), `mobile/assets/splash.png`.

## Estructura de archivos detallada

```
mobile/
├── app/
│   ├── _layout.tsx              # Root layout: ChakraProvider + Zustand + SQLite init
│   └── (tabs)/
│       ├── _layout.tsx          # Tab bar con 5 tabs y Feather icons
│       ├── index.tsx            # Tab Inicio
│       ├── equipo.tsx           # Tab Equipo
│       ├── issues.tsx           # Tab Issues
│       ├── analisis.tsx         # Tab Análisis
│       └── ajustes.tsx          # Tab Ajustes
├── components/
│   ├── KPICard.tsx
│   ├── ComparisonWidget.tsx
│   ├── ScorecardRow.tsx
│   ├── WipRiskCard.tsx
│   ├── AgingIssueRow.tsx
│   ├── BottleneckRow.tsx
│   ├── ForecastCard.tsx
│   └── SyncHeader.tsx           # Header con botón sync y timestamp
├── hooks/
│   ├── useKPIs.ts
│   ├── useTeam.ts
│   ├── useIssues.ts
│   ├── useAnalysis.ts
│   └── useSync.ts               # Orquesta el sync completo
├── store/
│   ├── syncStore.ts             # loading, lastSyncedAt, error
│   └── filterStore.ts           # persona, talla — persiste en AsyncStorage
├── lib/
│   ├── db.ts                    # openDatabase(), migrations, helpers
│   ├── sync.ts                  # fetchAll() + writeToDb()
│   ├── api.ts                   # fetch wrapper con baseUrl desde AsyncStorage
│   └── types.ts                 # Copia de server/src/types.ts
└── package.json
```

## Criterios de aceptación

- [ ] La app corre en iOS Simulator y Android Emulator con `npx expo start`
- [ ] Primera apertura sin sync muestra pantalla vacía con CTA "Sincronizar para ver datos"
- [ ] Sync completo (9 endpoints) tarda < 5 segundos en WiFi local
- [ ] Cambiar la URL en Ajustes y hacer sync usa la nueva URL sin reiniciar la app
- [ ] Los filtros globales (persona, talla) persisten entre sesiones
- [ ] Los gráficos (throughput, CFD, scatter, forecast histogram) renderizan correctamente en ambas plataformas
- [ ] El logo aparece correctamente en el splash screen y el ícono de app
