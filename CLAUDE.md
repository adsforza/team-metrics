# TeamMetrics

Tablero local de métricas Kanban para DevOps. Sincroniza issues de Jira Cloud → SQLite, clasifica complejidad con Claude AI (S/M/L/XL), y visualiza métricas de flujo por persona.

## Comandos

```bash
npm run dev          # arranca server (:3001) + client (:5173) en paralelo
npm run sync         # dispara sync manual con Jira
cd server && npm test
cd client && npm test
```

## Variables de entorno requeridas

Copiar `.env.example` → `.env` y completar:
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_BOARD_ID`
- `CLAUDE_API_KEY`

## Arquitectura

- `server/` — Express :3001, better-sqlite3, node-cron
- `client/` — Vite + React :5173, Recharts, Zustand
- `data/kanban.db` — SQLite (gitignored)

## Stack

**Server:** Node.js 20 + TypeScript + Express + better-sqlite3 + node-cron + @anthropic-ai/sdk + axios  
**Client:** Vite + React 18 + TypeScript + Recharts + Zustand + Tailwind CSS  
**Tests:** Vitest + supertest

## API endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/issues` | Issues filtrados |
| GET | `/api/metrics` | KPIs: wip, throughput, cycle_time_p50/p85, blocked_count |
| GET | `/api/metrics/by-talla` | Cycle time por S/M/L/XL |
| GET | `/api/metrics/cfd` | Cumulative Flow Diagram |
| GET | `/api/metrics/throughput` | Throughput semanal |
| GET | `/api/metrics/aging` | Issues sin movimiento |
| GET | `/api/team` | Métricas por persona con score A/B/C/D |
| GET | `/api/team/members` | Lista de miembros |
| POST | `/api/sync` | Sync manual con Jira |
| GET | `/api/sync/status` | Estado del último sync |

Todos los endpoints aceptan: `?from=YYYY-MM-DD&to=YYYY-MM-DD&assignee=id&talla=S,M&status=In+Progress`
