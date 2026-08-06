# TeamMetrics

Tablero local de métricas Kanban para equipos de DevOps. Sincroniza issues de **Jira Cloud → SQLite**, clasifica la complejidad de cada issue con **IA (Gemini)** en tallas S/M/L/XL, y visualiza métricas de flujo (cycle time, throughput, WIP, CFD, forecast Monte Carlo, scorecard por persona) en un **dashboard web** y una **app mobile**.

Todo corre **local** (sin hostear datos sensibles). La app mobile funciona contra el backend cuando está disponible, y **directo contra Jira** cuando no lo está.

## Arquitectura

```
Jira Cloud ──┐
             ├─► server (Express + SQLite)  ──►  client (dashboard web)
Gemini ──────┘            ▲   │
                          │   └──►  mobile (Expo/React Native)  ── backend mode
                          └──────  mobile ── direct mode (pega directo a Jira + Gemini)

shared/core  ── motor de métricas portable (TS puro), consumido por server y mobile
```

- **`server/`** — Express (:3001), better-sqlite3, node-cron. Sincroniza Jira, clasifica con Gemini y expone la API.
- **`client/`** — Vite + React (:5173), Recharts, Zustand, Tailwind. Dashboard web.
- **`mobile/`** — Expo / React Native. Dos modos de sync:
  - **backend**: baja snapshots + crudo del server.
  - **direct**: sin backend, pega directo a Jira (credenciales en `expo-secure-store`) y clasifica con Gemini en el dispositivo.
- **`shared/core/`** — `@teammetrics/core`: cálculo de métricas puro y portable (sin DB ni red), reusado por server y mobile para garantizar los mismos números en ambos.
- **`data/kanban.db`** — SQLite (gitignored).

## Stack

**Server:** Node 20 · TypeScript · Express · better-sqlite3 · node-cron · `@google/generative-ai` · axios
**Client:** Vite · React 18 · TypeScript · Recharts · Zustand · Tailwind CSS
**Mobile:** Expo · React Native · expo-sqlite · expo-secure-store · Zustand
**Tests:** Vitest + supertest (server/client/core) · Jest (mobile)

## Setup

Requisitos: Node 20, y para el mobile: Xcode (iOS) o Android Studio.

```bash
# 1. Instalar dependencias (raíz, server, client, mobile)
npm install
npm install --prefix server
npm install --prefix client
npm install --prefix mobile

# 2. Configurar credenciales
cp .env.example server/.env    # completar JIRA_* y GEMINI_API_KEY
```

Variables de entorno (ver `.env.example`): `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_BOARD_IDS`, `GEMINI_API_KEY`. El `.env` real **nunca** se commitea (está gitignored).

## Comandos

```bash
npm run dev            # server (:3001) + client (:5173) en paralelo
npm run sync           # dispara un sync manual con Jira
npm run build          # build de server + client

# Mobile
cd mobile && npx expo start        # dev (Metro)
# Release/offline: build desde Xcode/Android Studio

# Tests
cd server && npx vitest run
cd client && npx vitest run
cd shared/core && npx vitest run
cd mobile && npx jest
```

## API (server)

Todos los endpoints de métricas aceptan filtros: `?from=YYYY-MM-DD&to=YYYY-MM-DD&assignee=<id>&talla=S,M&status=In+Progress`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/issues` | Issues filtrados |
| GET | `/api/metrics` | KPIs: wip, throughput, cycle_time_p50/p85, blocked_count |
| GET | `/api/metrics/by-talla` | Cycle time por S/M/L/XL |
| GET | `/api/metrics/cfd` | Cumulative Flow Diagram |
| GET | `/api/metrics/throughput` | Throughput semanal |
| GET | `/api/metrics/aging` | Issues sin movimiento |
| GET | `/api/metrics/wip-risk` | WIP en riesgo vs. límite por talla |
| GET | `/api/metrics/bottleneck` | Cuellos de botella por estado |
| GET | `/api/metrics/forecast` | Forecast Monte Carlo (¿cuándo? / ¿cuántos?) |
| GET | `/api/metrics/comparison` | Comparativa semana vs. semana |
| GET | `/api/team` | Scorecard por persona (delivery/predictability/focus/flow/regresiones/bloqueados) |
| GET | `/api/team/members` | Lista de miembros |
| GET | `/api/raw` | Crudo (issues/transitions/members) con delta `?since=` — usado por el mobile |
| POST | `/api/tallas` | Recibe clasificaciones del mobile (fill-only) |
| POST | `/api/sync` | Sync manual con Jira |
| POST | `/api/sync/reclassify` | Reclasifica tallas pendientes |
| GET | `/api/sync/status` | Estado del último sync |

## Sync del mobile

- **En casa (backend mode):** poné la URL del server (IP LAN de la Mac) en Ajustes → Servidor. El mobile baja snapshots + crudo, y le empuja al server las tallas que haya clasificado offline (para no re-gastar cuota de Gemini).
- **Fuera de casa (direct mode):** cargá las credenciales de Jira/Gemini en Ajustes → "Jira directo". El mobile pega directo a Jira, clasifica con Gemini y computa las métricas en el dispositivo.
- **Delta incremental:** ambos modos bajan solo lo que cambió. Si un issue quedó con estado viejo (updates perdidos durante una caída del sync), usá **Ajustes → "Resync completo"** para re-bajar todo.

## Notas

- El repo **no contiene credenciales ni datos identificatorios**: la config real vive solo en `server/.env` (gitignored) y en el secure-store del dispositivo.
- Los diseños/planes de las features están en `docs/superpowers/`.
