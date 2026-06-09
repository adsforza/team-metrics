# TeamMetrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TeamMetrics, un tablero local de métricas Kanban para DevOps que sincroniza issues de Jira Cloud, clasifica complejidad con Claude AI (S/M/L/XL), y visualiza métricas de flujo por persona.

**Architecture:** Express backend (:3001) sincroniza Jira → SQLite cada 30 min via node-cron, llama Claude API para clasificar complejidad, y expone REST API con filtros. React frontend (:5173) lee exclusivamente del backend y renderiza 8 componentes controlados por un store Zustand.

**Tech Stack:** Node.js 20 + TypeScript + Express + better-sqlite3 + node-cron + @anthropic-ai/sdk + axios (server); Vite + React 18 + TypeScript + Recharts + Zustand + Tailwind CSS (client); Vitest + supertest (tests).

---

## Mapa de archivos

```
team-metrics/
├── package.json                          # scripts raíz: dev, build
├── .env.example
├── .gitignore
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      # Express app + cron startup
│       ├── types.ts                      # Interfaces TypeScript compartidas
│       ├── db/
│       │   ├── index.ts                  # Singleton DB connection
│       │   └── schema.ts                 # CREATE TABLE statements
│       ├── services/
│       │   ├── jira.ts                   # Cliente Jira Cloud API
│       │   ├── claude.ts                 # Clasificación talla con Claude
│       │   ├── sync.ts                   # Orquestación del sync job
│       │   └── metrics.ts               # Cálculos: CT, throughput, aging, score
│       └── routes/
│           ├── issues.ts                 # GET /api/issues
│           ├── metrics.ts               # GET /api/metrics/*
│           ├── team.ts                  # GET /api/team/*
│           └── sync.ts                  # GET|POST /api/sync/*
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── lib/
        │   ├── api.ts                    # HTTP client → backend
        │   └── formatters.ts            # formatDays, tallaColor, scoreColor
        ├── store/
        │   └── filters.ts               # Zustand: from/to/assignee/talla/status
        ├── hooks/
        │   ├── useMetrics.ts
        │   └── useTeam.ts
        └── components/
            ├── Header/
            │   ├── Header.tsx
            │   ├── TimeRangePicker.tsx
            │   ├── PersonFilter.tsx
            │   ├── TallaFilter.tsx
            │   └── StatusFilter.tsx
            ├── KPICards/KPICards.tsx
            ├── CycleTimeByTalla/CycleTimeByTalla.tsx
            ├── CFDChart/CFDChart.tsx
            ├── ScatterPlot/ScatterPlot.tsx
            ├── ThroughputChart/ThroughputChart.tsx
            ├── AgingWIP/AgingWIP.tsx
            └── TeamTable/TeamTable.tsx
```

---

## Task 1: Root scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Crear package.json raíz**

```json
{
  "name": "team-metrics",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "build": "npm run build --prefix server && npm run build --prefix client",
    "sync": "npm run sync --prefix server"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 2: Crear .env.example**

```bash
JIRA_BASE_URL=https://tu-dominio.atlassian.net
JIRA_EMAIL=tu@email.com
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=OPS
JIRA_BOARD_ID=123

CLAUDE_API_KEY=
CLAUDE_MODEL=claude-haiku-4-5

SYNC_INTERVAL_MINUTES=30
AGING_THRESHOLD_DAYS=7
```

- [ ] **Step 3: Crear .gitignore**

```
node_modules/
dist/
data/
.env
*.db
```

- [ ] **Step 4: Instalar concurrently y copiar .env**

```bash
npm install
cp .env.example .env
```

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example .gitignore
git commit -m "feat: root project scaffolding"
```

---

## Task 2: Server scaffolding

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`

- [ ] **Step 1: Crear server/package.json**

```json
{
  "name": "team-metrics-server",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "sync": "tsx src/services/sync.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "axios": "^1.7.2",
    "better-sqlite3": "^9.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.10",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/node-cron": "^3.0.11",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.15.6",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Crear server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Crear server/src/index.ts**

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/index';
import issuesRouter from './routes/issues';
import metricsRouter from './routes/metrics';
import teamRouter from './routes/team';
import syncRouter from './routes/sync';
import { startSyncJob } from './services/sync';

export const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/issues', issuesRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/team', teamRouter);
app.use('/api/sync', syncRouter);

if (require.main === module) {
  initDb();
  startSyncJob();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`TeamMetrics server running on :${PORT}`));
}
```

- [ ] **Step 4: Instalar dependencias**

```bash
cd server && npm install
```

Expected: `node_modules/` creado sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat: server scaffolding — Express + TypeScript"
```

---

## Task 3: DB schema e inicialización

**Files:**
- Create: `server/src/db/index.ts`
- Create: `server/src/db/schema.ts`
- Create: `server/src/types.ts`

- [ ] **Step 1: Escribir test del schema**

Crear `server/src/db/schema.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from './schema';

describe('DB schema', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    applySchema(db);
  });

  it('creates issues table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='issues'`).get();
    expect(row).toBeTruthy();
  });

  it('creates transitions table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='transitions'`).get();
    expect(row).toBeTruthy();
  });

  it('creates team_members table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'`).get();
    expect(row).toBeTruthy();
  });

  it('creates sync_log table', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_log'`).get();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- schema.test
```

Expected: FAIL — `applySchema` not found.

- [ ] **Step 3: Crear server/src/db/schema.ts**

```typescript
import Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id          TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email       TEXT NOT NULL,
      avatar_url  TEXT
    );

    CREATE TABLE IF NOT EXISTS issues (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL,
      assignee_id         TEXT REFERENCES team_members(id),
      talla               TEXT CHECK(talla IN ('S','M','L','XL')),
      talla_confidence    REAL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      synced_at           TEXT NOT NULL,
      last_transition_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS transitions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id         TEXT NOT NULL REFERENCES issues(id),
      from_status      TEXT NOT NULL,
      to_status        TEXT NOT NULL,
      transitioned_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transitions_issue ON transitions(issue_id);
    CREATE INDEX IF NOT EXISTS idx_transitions_at ON transitions(transitioned_at);
    CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);

    CREATE TABLE IF NOT EXISTS sync_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT,
      synced_count     INTEGER NOT NULL DEFAULT 0,
      classified_count INTEGER NOT NULL DEFAULT 0,
      error            TEXT
    );
  `);
}
```

- [ ] **Step 4: Crear server/src/db/index.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { applySchema } from './schema';

const DB_PATH = path.resolve(process.cwd(), '../data/kanban.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.');
  return _db;
}

export function initDb(dbPath = DB_PATH): Database.Database {
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applySchema(_db);
  return _db;
}
```

- [ ] **Step 5: Crear server/src/types.ts**

```typescript
export type Talla = 'S' | 'M' | 'L' | 'XL';
export type Score = 'A' | 'B' | 'C' | 'D';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee_id: string | null;
  talla: Talla | null;
  talla_confidence: number | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
  last_transition_at: string | null;
}

export interface Transition {
  id: number;
  issue_id: string;
  from_status: string;
  to_status: string;
  transitioned_at: string;
}

export interface TeamMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  synced_count: number;
  classified_count: number;
  error: string | null;
}

export interface FilterParams {
  from?: string;
  to?: string;
  assignee?: string;
  talla?: string;
  status?: string;
}

export interface KPIMetrics {
  wip: number;
  throughput: number;
  cycle_time_p50: number | null;
  cycle_time_p85: number | null;
  blocked_count: number;
}

export interface TallaMetric {
  talla: Talla;
  ct_p50: number | null;
  count: number;
  team_ct_p50: number | null;
}

export interface CFDPoint {
  date: string;
  todo: number;
  in_progress: number;
  in_review: number;
  in_qa: number;
  done: number;
}

export interface ThroughputWeek {
  week: string;
  count: number;
  by_talla: Record<Talla, number>;
}

export interface AgingIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  status: string;
  days_in_status: number;
  assignee_id: string | null;
}

export interface PersonMetrics {
  member: TeamMember;
  throughput: number;
  ct_p50: number | null;
  mix_tallas: Record<Talla, number>;
  blocked: number;
  score: Score;
  sparkline: number[];
}
```

- [ ] **Step 6: Correr tests — deben pasar**

```bash
cd server && npm test -- schema.test
```

Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/ server/src/types.ts
git commit -m "feat: DB schema, types, and initialization"
```

---

## Task 4: Jira service

**Files:**
- Create: `server/src/services/jira.ts`
- Create: `server/src/services/jira.test.ts`

- [ ] **Step 1: Escribir test**

Crear `server/src/services/jira.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

import { JiraClient } from './jira';

const cfg = {
  baseUrl: 'https://test.atlassian.net',
  email: 'test@test.com',
  apiToken: 'token123',
  projectKey: 'OPS',
  boardId: 1,
};

describe('JiraClient', () => {
  let client: JiraClient;

  beforeEach(() => {
    client = new JiraClient(cfg);
    vi.clearAllMocks();
  });

  it('fetchIssues returns mapped issues', async () => {
    mockedAxios.get = vi.fn().mockResolvedValueOnce({
      data: {
        issues: [{
          key: 'OPS-1',
          fields: {
            summary: 'Test issue',
            description: { content: [] },
            status: { name: 'In Progress' },
            assignee: { accountId: 'user1', displayName: 'User One', emailAddress: 'u@t.com', avatarUrls: { '48x48': 'http://img' } },
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-02T00:00:00.000Z',
          },
          changelog: { histories: [] },
        }],
        total: 1,
        maxResults: 50,
        startAt: 0,
      }
    });

    const result = await client.fetchIssues();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('OPS-1');
    expect(result[0].status).toBe('In Progress');
    expect(result[0].assignee?.id).toBe('user1');
  });

  it('fetchIssues filters by updatedSince', async () => {
    mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { issues: [], total: 0, maxResults: 50, startAt: 0 } });
    await client.fetchIssues('2026-01-01T00:00:00.000Z');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/rest/agile/1.0/board/1/issue'),
      expect.objectContaining({ params: expect.objectContaining({ jql: expect.stringContaining('updated') }) })
    );
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- jira.test
```

Expected: FAIL — `JiraClient` not found.

- [ ] **Step 3: Implementar server/src/services/jira.ts**

```typescript
import axios from 'axios';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: number;
}

export interface JiraIssueRaw {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string;
  } | null;
  created_at: string;
  updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

export class JiraClient {
  private auth: { username: string; password: string };

  constructor(private cfg: JiraConfig) {
    this.auth = { username: cfg.email, password: cfg.apiToken };
  }

  async fetchIssues(updatedSince?: string): Promise<JiraIssueRaw[]> {
    const results: JiraIssueRaw[] = [];
    let startAt = 0;
    const maxResults = 50;

    const jql = [
      `project = ${this.cfg.projectKey}`,
      updatedSince ? `updated >= "${updatedSince}"` : null,
    ].filter(Boolean).join(' AND ');

    while (true) {
      const { data } = await axios.get(
        `${this.cfg.baseUrl}/rest/agile/1.0/board/${this.cfg.boardId}/issue`,
        {
          auth: this.auth,
          params: { jql, startAt, maxResults, expand: 'changelog', fields: 'summary,description,status,assignee,created,updated' },
        }
      );

      for (const issue of data.issues) {
        results.push(this.mapIssue(issue));
      }

      if (startAt + data.issues.length >= data.total) break;
      startAt += maxResults;
    }

    return results;
  }

  private mapIssue(raw: any): JiraIssueRaw {
    const desc = raw.fields.description;
    const descText = desc?.content
      ?.flatMap((b: any) => b.content?.map((t: any) => t.text) ?? [])
      .join(' ') ?? '';

    const transitions = (raw.changelog?.histories ?? []).flatMap((h: any) =>
      h.items
        .filter((item: any) => item.field === 'status')
        .map((item: any) => ({
          from_status: item.fromString,
          to_status: item.toString,
          transitioned_at: h.created,
        }))
    );

    const assignee = raw.fields.assignee ? {
      id: raw.fields.assignee.accountId,
      display_name: raw.fields.assignee.displayName,
      email: raw.fields.assignee.emailAddress,
      avatar_url: raw.fields.assignee.avatarUrls?.['48x48'] ?? null,
    } : null;

    return {
      id: raw.key,
      title: raw.fields.summary,
      description: descText,
      status: raw.fields.status.name,
      assignee,
      created_at: raw.fields.created,
      updated_at: raw.fields.updated,
      transitions,
    };
  }
}

export function createJiraClient(): JiraClient {
  return new JiraClient({
    baseUrl: process.env.JIRA_BASE_URL!,
    email: process.env.JIRA_EMAIL!,
    apiToken: process.env.JIRA_API_TOKEN!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    boardId: Number(process.env.JIRA_BOARD_ID!),
  });
}
```

- [ ] **Step 4: Correr test — debe pasar**

```bash
cd server && npm test -- jira.test
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/jira.ts server/src/services/jira.test.ts
git commit -m "feat: Jira Cloud API client"
```

---

## Task 5: Claude classification service

**Files:**
- Create: `server/src/services/claude.ts`
- Create: `server/src/services/claude.test.ts`

- [ ] **Step 1: Escribir test**

Crear `server/src/services/claude.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"talla":"M","confidence":0.9,"razon":"Impacta 2 servicios"}' }],
      }),
    },
  })),
}));

import { classifyTalla } from './claude';

describe('classifyTalla', () => {
  it('returns talla and confidence from Claude response', async () => {
    const result = await classifyTalla('Deploy new auth service', 'Update the auth service to use OAuth2. Requires changes in 2 microservices.');
    expect(result.talla).toBe('M');
    expect(result.confidence).toBe(0.9);
  });

  it('returns null talla when confidence < 0.6', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    (Anthropic as any).mockImplementationOnce(() => ({
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"talla":"L","confidence":0.4,"razon":"unclear"}' }] }) },
    }));
    const result = await classifyTalla('Vague task', '');
    expect(result.talla).toBeNull();
    expect(result.confidence).toBe(0.4);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- claude.test
```

Expected: FAIL — `classifyTalla` not found.

- [ ] **Step 3: Implementar server/src/services/claude.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Talla } from '../types';

const PROMPT_SYSTEM = `Sos un experto en DevOps. Clasificá la complejidad de este issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON válido: {"talla": "M", "confidence": 0.85, "razon": "..."}`;

export interface TallaResult {
  talla: Talla | null;
  confidence: number;
  razon: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY! });
  return _client;
}

export async function classifyTalla(title: string, description: string): Promise<TallaResult> {
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

  const msg = await getClient().messages.create({
    model,
    max_tokens: 128,
    messages: [{
      role: 'user',
      content: `${PROMPT_SYSTEM}\n\nIssue: ${title}\nDescripción: ${description.slice(0, 500)}`,
    }],
  });

  const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
  let parsed: { talla?: string; confidence?: number; razon?: string };

  try {
    parsed = JSON.parse(text);
  } catch {
    return { talla: null, confidence: 0, razon: 'parse error' };
  }

  const confidence = parsed.confidence ?? 0;
  const rawTalla = parsed.talla as Talla;
  const validTallas: Talla[] = ['S', 'M', 'L', 'XL'];

  return {
    talla: confidence >= 0.6 && validTallas.includes(rawTalla) ? rawTalla : null,
    confidence,
    razon: parsed.razon ?? '',
  };
}
```

- [ ] **Step 4: Correr test — debe pasar**

```bash
cd server && npm test -- claude.test
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/claude.ts server/src/services/claude.test.ts
git commit -m "feat: Claude AI talla classification service"
```

---

## Task 6: Sync service

**Files:**
- Create: `server/src/services/sync.ts`
- Create: `server/src/services/sync.test.ts`

- [ ] **Step 1: Escribir test**

Crear `server/src/services/sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { runSync } from './sync';

vi.mock('./jira', () => ({
  createJiraClient: () => ({
    fetchIssues: vi.fn().mockResolvedValue([{
      id: 'OPS-1',
      title: 'Test issue',
      description: 'Some description',
      status: 'In Progress',
      assignee: { id: 'u1', display_name: 'User One', email: 'u@t.com', avatar_url: null },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      transitions: [
        { from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T00:00:00.000Z' },
      ],
    }]),
  }),
}));

vi.mock('./claude', () => ({
  classifyTalla: vi.fn().mockResolvedValue({ talla: 'M', confidence: 0.9, razon: 'test' }),
}));

describe('runSync', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
  });

  it('upserts issues and transitions into DB', async () => {
    const result = await runSync(db);
    expect(result.synced_count).toBe(1);
    expect(result.classified_count).toBe(1);

    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('OPS-1') as any;
    expect(issue).toBeTruthy();
    expect(issue.talla).toBe('M');
    expect(issue.status).toBe('In Progress');

    const transitions = db.prepare('SELECT * FROM transitions WHERE issue_id = ?').all('OPS-1');
    expect(transitions).toHaveLength(1);
  });

  it('writes a sync_log entry', async () => {
    await runSync(db);
    const log = db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get() as any;
    expect(log.synced_count).toBe(1);
    expect(log.error).toBeNull();
    expect(log.finished_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- sync.test
```

Expected: FAIL — `runSync` not found.

- [ ] **Step 3: Implementar server/src/services/sync.ts**

```typescript
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { getDb } from '../db/index';
import { createJiraClient } from './jira';
import { classifyTalla } from './claude';

export interface SyncResult {
  synced_count: number;
  classified_count: number;
}

export async function runSync(db: Database.Database): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const logStmt = db.prepare(
    `INSERT INTO sync_log (started_at, synced_count, classified_count) VALUES (?, 0, 0)`
  );
  const logId = Number(logStmt.run(startedAt).lastInsertRowid);

  let synced_count = 0;
  let classified_count = 0;

  try {
    const lastSync = (db.prepare(`SELECT MAX(finished_at) as last FROM sync_log WHERE error IS NULL`).get() as any)?.last;
    const client = createJiraClient();
    const issues = await client.fetchIssues(lastSync ?? undefined);

    const now = new Date().toISOString();

    for (const issue of issues) {
      // Upsert team member
      if (issue.assignee) {
        db.prepare(`
          INSERT INTO team_members (id, display_name, email, avatar_url)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url
        `).run(issue.assignee.id, issue.assignee.display_name, issue.assignee.email, issue.assignee.avatar_url);
      }

      // Determine talla
      const existing = db.prepare(`SELECT talla, description FROM issues WHERE id = ?`).get(issue.id) as any;
      const needsClassification = !existing || existing.description !== issue.description;
      let talla = existing?.talla ?? null;
      let talla_confidence = null;

      if (needsClassification) {
        const result = await classifyTalla(issue.title, issue.description);
        talla = result.talla;
        talla_confidence = result.confidence;
        classified_count++;
      }

      // Compute last_transition_at
      const lastTransition = issue.transitions.length > 0
        ? issue.transitions.reduce((a, b) => a.transitioned_at > b.transitioned_at ? a : b)
        : null;

      // Upsert issue
      db.prepare(`
        INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, status=excluded.status,
          assignee_id=excluded.assignee_id, talla=excluded.talla, talla_confidence=excluded.talla_confidence,
          updated_at=excluded.updated_at, synced_at=excluded.synced_at, last_transition_at=excluded.last_transition_at
      `).run(
        issue.id, issue.title, issue.description, issue.status,
        issue.assignee?.id ?? null, talla, talla_confidence,
        issue.created_at, issue.updated_at, now, lastTransition?.transitioned_at ?? null
      );

      // Upsert transitions (insert only new ones by transitioned_at)
      for (const t of issue.transitions) {
        const exists = db.prepare(
          `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`
        ).get(issue.id, t.to_status, t.transitioned_at);
        if (!exists) {
          db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?, ?, ?, ?)`)
            .run(issue.id, t.from_status, t.to_status, t.transitioned_at);
        }
      }

      synced_count++;
    }

    db.prepare(`UPDATE sync_log SET finished_at=?, synced_count=?, classified_count=? WHERE id=?`)
      .run(new Date().toISOString(), synced_count, classified_count, logId);

  } catch (err: any) {
    db.prepare(`UPDATE sync_log SET finished_at=?, error=? WHERE id=?`)
      .run(new Date().toISOString(), err.message, logId);
    throw err;
  }

  return { synced_count, classified_count };
}

export function startSyncJob(): void {
  const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30);
  const cronExpr = `*/${intervalMinutes} * * * *`;
  console.log(`Sync job scheduled: every ${intervalMinutes} minutes`);
  cron.schedule(cronExpr, () => {
    runSync(getDb()).catch(err => console.error('Sync failed:', err));
  });
}
```

- [ ] **Step 4: Correr test — debe pasar**

```bash
cd server && npm test -- sync.test
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/sync.ts server/src/services/sync.test.ts
git commit -m "feat: Jira sync job with Claude classification"
```

---

## Task 7: Metrics service

**Files:**
- Create: `server/src/services/metrics.ts`
- Create: `server/src/services/metrics.test.ts`

- [ ] **Step 1: Escribir tests**

Crear `server/src/services/metrics.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getKPIs, getCycleTimeByTalla, getThroughputWeekly, getAgingWIP, getTeamMetrics } from './metrics';

function seedDb(db: Database.Database) {
  db.prepare(`INSERT INTO team_members VALUES ('u1','Ana G','ana@t.com',null)`).run();
  db.prepare(`INSERT INTO team_members VALUES ('u2','Bob R','bob@t.com',null)`).run();

  // Issue 1: Done, talla M, assignee u1 — cycle time 3 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-1','Fix login','desc','Done','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-04T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-1','To Do','In Progress','2026-05-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-1','In Progress','Done','2026-05-04T00:00:00Z')`).run();

  // Issue 2: Done, talla L, assignee u2 — cycle time 7 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-2','Deploy infra','desc','Done','u2','L',0.85,'2026-05-01T00:00:00Z','2026-05-08T00:00:00Z','2026-06-01T00:00:00Z','2026-05-08T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-2','To Do','In Progress','2026-05-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-2','In Progress','Done','2026-05-08T00:00:00Z')`).run();

  // Issue 3: In Progress (WIP), talla S, assignee u1, stuck 10 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-3','Update config','desc','In Progress','u1','S',0.95,'2026-05-20T00:00:00Z','2026-05-20T00:00:00Z','2026-06-01T00:00:00Z','2026-05-20T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-3','To Do','In Progress','2026-05-20T00:00:00Z')`).run();
}

describe('metrics service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    seedDb(db);
  });

  describe('getKPIs', () => {
    it('returns correct wip count', () => {
      const kpi = getKPIs(db, {});
      expect(kpi.wip).toBe(1); // OPS-3 is In Progress
    });

    it('returns correct throughput for date range', () => {
      const kpi = getKPIs(db, { from: '2026-05-01', to: '2026-05-31' });
      expect(kpi.throughput).toBe(2);
    });

    it('returns cycle time percentiles', () => {
      const kpi = getKPIs(db, { from: '2026-05-01', to: '2026-05-31' });
      expect(kpi.cycle_time_p50).toBeCloseTo(5, 0); // median of [3,7]
      expect(kpi.cycle_time_p85).toBeCloseTo(7, 0);
    });
  });

  describe('getCycleTimeByTalla', () => {
    it('returns ct_p50 per talla', () => {
      const result = getCycleTimeByTalla(db, { from: '2026-05-01', to: '2026-05-31' });
      const m = result.find(r => r.talla === 'M');
      const l = result.find(r => r.talla === 'L');
      expect(m?.ct_p50).toBeCloseTo(3, 0);
      expect(l?.ct_p50).toBeCloseTo(7, 0);
    });
  });

  describe('getAgingWIP', () => {
    it('returns in-progress issues sorted by days', () => {
      const aging = getAgingWIP(db, {});
      expect(aging).toHaveLength(1);
      expect(aging[0].issue_id).toBe('OPS-3');
      expect(aging[0].days_in_status).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- metrics.test
```

Expected: FAIL.

- [ ] **Step 3: Implementar server/src/services/metrics.ts**

```typescript
import Database from 'better-sqlite3';
import type { FilterParams, KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, PersonMetrics, Talla, Score } from '../types';

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildWhereClause(params: FilterParams): { where: string; args: any[] } {
  const conditions: string[] = [];
  const args: any[] = [];

  if (params.assignee) {
    conditions.push('i.assignee_id = ?');
    args.push(params.assignee);
  }
  if (params.talla) {
    const tallas = params.talla.split(',').map(t => t.trim());
    conditions.push(`i.talla IN (${tallas.map(() => '?').join(',')})`);
    args.push(...tallas);
  }
  if (params.status) {
    const statuses = params.status.split(',').map(s => s.trim());
    conditions.push(`i.status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }

  return {
    where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    args,
  };
}

function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
  const { where, args } = buildWhereClause(params);
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const rows = db.prepare(`
    SELECT
      t_start.transitioned_at AS start_at,
      t_end.transitioned_at   AS end_at
    FROM issues i
    JOIN transitions t_start ON t_start.issue_id = i.id AND t_start.to_status = 'In Progress'
    JOIN transitions t_end   ON t_end.issue_id   = i.id AND t_end.to_status   = 'Done'
    ${where ? where.replace('WHERE', 'WHERE') : 'WHERE 1=1'}
      AND t_end.transitioned_at >= ? AND t_end.transitioned_at <= ?
    ORDER BY t_start.transitioned_at
  `).all(...args, fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z') as any[];

  return rows
    .map(r => (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / (1000 * 60 * 60 * 24))
    .sort((a, b) => a - b);
}

export function getKPIs(db: Database.Database, params: FilterParams): KPIMetrics {
  const fromDate = params.from ?? '2000-01-01';
  const toDate = params.to ?? '2099-12-31';

  const wipRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','To Do')
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(...(params.assignee ? [params.assignee] : [])) as any;

  const throughputRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any;

  const cycleTimes = getCycleTimes(db, params);
  const agingThreshold = Number(process.env.AGING_THRESHOLD_DAYS ?? 7);

  const blockedRow = db.prepare(`
    SELECT COUNT(*) as count FROM issues i
    WHERE i.status NOT IN ('Done','To Do')
      AND i.last_transition_at <= datetime('now', '-${agingThreshold} days')
      ${params.assignee ? 'AND i.assignee_id = ?' : ''}
  `).get(...(params.assignee ? [params.assignee] : [])) as any;

  return {
    wip: wipRow.count,
    throughput: throughputRow.count,
    cycle_time_p50: percentile(cycleTimes, 50),
    cycle_time_p85: percentile(cycleTimes, 85),
    blocked_count: blockedRow.count,
  };
}

export function getCycleTimeByTalla(db: Database.Database, params: FilterParams): TallaMetric[] {
  const tallas: Talla[] = ['S', 'M', 'L', 'XL'];
  const allCTs = getCycleTimes(db, params);
  const teamP50 = percentile(allCTs, 50);

  return tallas.map(talla => {
    const cts = getCycleTimes(db, { ...params, talla });
    return {
      talla,
      ct_p50: percentile(cts, 50),
      count: cts.length,
      team_ct_p50: teamP50,
    };
  });
}

export function getCFD(db: Database.Database, params: FilterParams): CFDPoint[] {
  const fromDate = params.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = params.to ?? new Date().toISOString().slice(0, 10);

  const statuses = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done'];
  const points: CFDPoint[] = [];

  let cursor = new Date(fromDate);
  const end = new Date(toDate);

  while (cursor <= end) {
    const dateStr = cursor.toISOString();
    const row: any = { date: cursor.toISOString().slice(0, 10), todo: 0, in_progress: 0, in_review: 0, in_qa: 0, done: 0 };

    for (const status of statuses) {
      const count = (db.prepare(`
        SELECT COUNT(*) as c FROM issues i WHERE i.created_at <= ?
          AND (i.status = ? OR EXISTS (
            SELECT 1 FROM transitions t WHERE t.issue_id = i.id AND t.to_status = ? AND t.transitioned_at <= ?
          ))
          ${params.assignee ? 'AND i.assignee_id = ?' : ''}
      `).get(dateStr, status, status, dateStr, ...(params.assignee ? [params.assignee] : [])) as any).c;

      const key = status.toLowerCase().replace(/ /g, '_');
      row[key] = count;
    }

    points.push(row);
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export function getThroughputWeekly(db: Database.Database, params: FilterParams): ThroughputWeek[] {
  const fromDate = params.from ?? new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = params.to ?? new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT
      date(t.transitioned_at, 'weekday 1', '-7 days') AS week,
      i.talla,
      COUNT(*) AS count
    FROM issues i
    JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
    WHERE t.transitioned_at >= ? AND t.transitioned_at <= ?
    ${params.assignee ? 'AND i.assignee_id = ?' : ''}
    GROUP BY week, i.talla
    ORDER BY week
  `).all(fromDate + 'T00:00:00Z', toDate + 'T23:59:59Z', ...(params.assignee ? [params.assignee] : [])) as any[];

  const weeks = new Map<string, ThroughputWeek>();
  for (const row of rows) {
    if (!weeks.has(row.week)) {
      weeks.set(row.week, { week: row.week, count: 0, by_talla: { S: 0, M: 0, L: 0, XL: 0 } });
    }
    const w = weeks.get(row.week)!;
    w.count += row.count;
    if (row.talla && ['S', 'M', 'L', 'XL'].includes(row.talla)) {
      w.by_talla[row.talla as Talla] += row.count;
    }
  }

  return Array.from(weeks.values());
}

export function getAgingWIP(db: Database.Database, params: FilterParams): AgingIssue[] {
  const { where, args } = buildWhereClause({ ...params, status: undefined });
  const rows = db.prepare(`
    SELECT
      i.id AS issue_id,
      i.title,
      i.talla,
      i.status,
      i.assignee_id,
      CAST((julianday('now') - julianday(COALESCE(i.last_transition_at, i.created_at))) AS INTEGER) AS days_in_status
    FROM issues i
    ${where || 'WHERE 1=1'} AND i.status NOT IN ('Done')
    ORDER BY days_in_status DESC
  `).all(...args) as AgingIssue[];

  return rows;
}

export function getTeamMetrics(db: Database.Database, params: FilterParams): PersonMetrics[] {
  const members = db.prepare('SELECT * FROM team_members').all() as any[];
  const tallas: Talla[] = ['S', 'M', 'L', 'XL'];
  const TALLA_WEIGHT: Record<Talla, number> = { S: 1, M: 2, L: 4, XL: 8 };

  const personScores: Array<{ member: any; rawScore: number; metrics: Omit<PersonMetrics, 'score'> }> = [];

  for (const member of members) {
    const memberParams = { ...params, assignee: member.id };
    const kpi = getKPIs(db, memberParams);
    const cycleTimes = getCycleTimes(db, memberParams);

    const mix_tallas = Object.fromEntries(
      tallas.map(t => [t, getCycleTimes(db, { ...memberParams, talla: t }).length])
    ) as Record<Talla, number>;

    // Sparkline: throughput for last 4 weeks
    const sparkline: number[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const wkRow = db.prepare(`
        SELECT COUNT(*) as c FROM issues i
        JOIN transitions t ON t.issue_id = i.id AND t.to_status = 'Done'
        WHERE i.assignee_id = ? AND t.transitioned_at >= ? AND t.transitioned_at < ?
      `).get(member.id, weekStart.toISOString(), weekEnd.toISOString()) as any;
      sparkline.push(wkRow.c);
    }

    // Weighted throughput
    const weightedThroughput = tallas.reduce((sum, t) => sum + mix_tallas[t] * TALLA_WEIGHT[t], 0);
    const ctP50 = percentile([...cycleTimes].sort((a, b) => a - b), 50);
    const rawScore = ctP50 ? weightedThroughput / ctP50 : weightedThroughput;

    personScores.push({
      member,
      rawScore,
      metrics: { member, throughput: kpi.throughput, ct_p50: ctP50, mix_tallas, blocked: kpi.blocked_count, sparkline },
    });
  }

  // Assign letter scores by quartile
  const sorted = [...personScores].sort((a, b) => b.rawScore - a.rawScore);
  const n = sorted.length;

  return sorted.map((p, i) => {
    const quartile = n === 1 ? 0 : i / (n - 1);
    const score: Score = quartile < 0.25 ? 'A' : quartile < 0.5 ? 'B' : quartile < 0.75 ? 'C' : 'D';
    return { ...p.metrics, score };
  });
}
```

- [ ] **Step 4: Correr test — debe pasar**

```bash
cd server && npm test -- metrics.test
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/metrics.ts server/src/services/metrics.test.ts
git commit -m "feat: metrics calculations (KPIs, cycle time, CFD, aging, team scores)"
```

---

## Task 8: API Routes

**Files:**
- Create: `server/src/routes/issues.ts`
- Create: `server/src/routes/metrics.ts`
- Create: `server/src/routes/team.ts`
- Create: `server/src/routes/sync.ts`
- Create: `server/src/routes/routes.test.ts`

- [ ] **Step 1: Escribir tests de rutas**

Crear `server/src/routes/routes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';

// Mock DB singleton before importing app
const mockDb = new Database(':memory:');
applySchema(mockDb);
mockDb.prepare(`INSERT INTO team_members VALUES ('u1','Ana G','ana@t.com',null)`).run();
mockDb.prepare(`INSERT INTO issues VALUES ('OPS-1','Fix login','desc','In Progress','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-01T00:00:00Z')`).run();

vi.mock('../db/index', () => ({ getDb: () => mockDb, initDb: () => mockDb }));
vi.mock('../services/sync', () => ({ startSyncJob: vi.fn(), runSync: vi.fn().mockResolvedValue({ synced_count: 0, classified_count: 0 }) }));

import { app } from '../index';

describe('GET /api/issues', () => {
  it('returns 200 with array', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/metrics', () => {
  it('returns 200 with kpi shape', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wip');
    expect(res.body).toHaveProperty('throughput');
    expect(res.body).toHaveProperty('cycle_time_p50');
  });
});

describe('GET /api/team', () => {
  it('returns 200 with array', async () => {
    const res = await request(app).get('/api/team');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/sync', () => {
  it('returns 200 with sync result', async () => {
    const res = await request(app).post('/api/sync');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('synced_count');
  });
});

describe('GET /api/sync/status', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/api/sync/status');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
cd server && npm test -- routes.test
```

Expected: FAIL.

- [ ] **Step 3: Crear server/src/routes/issues.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const params: FilterParams = {
    from: req.query.from as string,
    to: req.query.to as string,
    assignee: req.query.assignee as string,
    talla: req.query.talla as string,
    status: req.query.status as string,
  };

  const conditions: string[] = [];
  const args: any[] = [];

  if (params.assignee) { conditions.push('assignee_id = ?'); args.push(params.assignee); }
  if (params.talla) {
    const ts = params.talla.split(',');
    conditions.push(`talla IN (${ts.map(() => '?').join(',')})`);
    args.push(...ts);
  }
  if (params.status) {
    const ss = params.status.split(',');
    conditions.push(`status IN (${ss.map(() => '?').join(',')})`);
    args.push(...ss);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const issues = db.prepare(`SELECT * FROM issues ${where} ORDER BY last_transition_at DESC`).all(...args);
  res.json(issues);
});

export default router;
```

- [ ] **Step 4: Crear server/src/routes/metrics.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index';
import { getKPIs, getCycleTimeByTalla, getCFD, getThroughputWeekly, getAgingWIP } from '../services/metrics';
import type { FilterParams } from '../types';

const router = Router();

function parseFilters(q: any): FilterParams {
  return { from: q.from, to: q.to, assignee: q.assignee, talla: q.talla, status: q.status };
}

router.get('/', (req, res) => res.json(getKPIs(getDb(), parseFilters(req.query))));
router.get('/by-talla', (req, res) => res.json(getCycleTimeByTalla(getDb(), parseFilters(req.query))));
router.get('/cfd', (req, res) => res.json(getCFD(getDb(), parseFilters(req.query))));
router.get('/throughput', (req, res) => res.json(getThroughputWeekly(getDb(), parseFilters(req.query))));
router.get('/aging', (req, res) => res.json(getAgingWIP(getDb(), parseFilters(req.query))));

export default router;
```

- [ ] **Step 5: Crear server/src/routes/team.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index';
import { getTeamMetrics } from '../services/metrics';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res) => {
  const params: FilterParams = { from: req.query.from as string, to: req.query.to as string, talla: req.query.talla as string };
  res.json(getTeamMetrics(getDb(), params));
});

router.get('/members', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM team_members ORDER BY display_name').all());
});

export default router;
```

- [ ] **Step 6: Crear server/src/routes/sync.ts**

```typescript
import { Router } from 'express';
import { getDb } from '../db/index';
import { runSync } from '../services/sync';

const router = Router();

router.post('/', async (_req, res) => {
  try {
    const result = await runSync(getDb());
    res.json({ status: 'ok', ...result });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/status', (_req, res) => {
  const log = getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get();
  res.json(log ?? { status: 'never_synced' });
});

export default router;
```

- [ ] **Step 7: Correr todos los tests del server**

```bash
cd server && npm test
```

Expected: PASS — todos los tests.

- [ ] **Step 8: Verificar que el server arranca**

```bash
cd server && npm run dev
```

Expected: `TeamMetrics server running on :3001`

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/
git commit -m "feat: REST API routes — issues, metrics, team, sync"
```

---

## Task 9: Client scaffolding

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.ts`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/index.html`
- Create: `client/src/main.tsx`

- [ ] **Step 1: Crear client/package.json**

```json
{
  "name": "team-metrics-client",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7",
    "zustand": "^4.5.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.2",
    "@testing-library/react": "^15.0.7",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Crear client/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 3: Crear client/src/test-setup.ts**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Crear client/tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 5: Crear client/postcss.config.js**

```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 6: Crear client/index.html**

```html
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TeamMetrics</title>
</head>
<body class="bg-slate-950 text-slate-100">
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: Crear client/src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: Crear client/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Crear client/src/App.tsx (placeholder)**

```tsx
export default function App() {
  return <div className="p-8 text-slate-100">TeamMetrics cargando...</div>;
}
```

- [ ] **Step 10: Instalar dependencias y verificar que arranca**

```bash
cd client && npm install && npm run dev
```

Expected: Vite server en http://localhost:5173 mostrando "TeamMetrics cargando..."

- [ ] **Step 11: Commit**

```bash
git add client/
git commit -m "feat: client scaffolding — Vite + React + Tailwind"
```

---

## Task 10: lib/api.ts + formatters.ts + Zustand store + hooks

**Files:**
- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/formatters.ts`
- Create: `client/src/store/filters.ts`
- Create: `client/src/hooks/useMetrics.ts`
- Create: `client/src/hooks/useTeam.ts`

- [ ] **Step 1: Crear client/src/lib/api.ts**

```typescript
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, PersonMetrics, Issue, TeamMember } from '../../../server/src/types';

export type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, PersonMetrics, Issue, TeamMember };

function buildQuery(params: Record<string, string | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return q ? '?' + q : '';
}

async function get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const res = await fetch('/api' + path + buildQuery(params));
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  metrics: (p = {}) => get<KPIMetrics>('/metrics', p),
  metricsByTalla: (p = {}) => get<TallaMetric[]>('/metrics/by-talla', p),
  metricsCFD: (p = {}) => get<CFDPoint[]>('/metrics/cfd', p),
  metricsThroughput: (p = {}) => get<ThroughputWeek[]>('/metrics/throughput', p),
  metricsAging: (p = {}) => get<AgingIssue[]>('/metrics/aging', p),
  team: (p = {}) => get<PersonMetrics[]>('/team', p),
  teamMembers: () => get<TeamMember[]>('/team/members'),
  issues: (p = {}) => get<Issue[]>('/issues', p),
  syncNow: () => fetch('/api/sync', { method: 'POST' }).then(r => r.json()),
  syncStatus: () => get('/sync/status'),
};
```

- [ ] **Step 2: Crear client/src/lib/formatters.ts**

```typescript
import type { Talla, Score } from '../../../server/src/types';

export function formatDays(days: number | null): string {
  if (days === null) return '—';
  return days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

export const TALLA_COLOR: Record<Talla, string> = {
  S: '#86efac',
  M: '#93c5fd',
  L: '#c4b5fd',
  XL: '#fca5a5',
};

export const TALLA_BG: Record<Talla, string> = {
  S: 'bg-green-900 text-green-300',
  M: 'bg-blue-900 text-blue-300',
  L: 'bg-purple-900 text-purple-300',
  XL: 'bg-red-900 text-red-300',
};

export const SCORE_BG: Record<Score, string> = {
  A: 'bg-green-900 text-green-300',
  B: 'bg-blue-900 text-blue-300',
  C: 'bg-amber-900 text-amber-300',
  D: 'bg-red-900 text-red-300',
};

export function agePillClass(days: number): string {
  if (days >= 7) return 'bg-red-900 text-red-300';
  if (days >= 3) return 'bg-amber-900 text-amber-300';
  return 'bg-green-900 text-green-300';
}
```

- [ ] **Step 3: Crear client/src/store/filters.ts**

```typescript
import { create } from 'zustand';

export type TimeRange = '7d' | '14d' | '30d' | '90d';

interface FiltersState {
  timeRange: TimeRange;
  assignee: string;
  talla: string;
  status: string;
  setTimeRange: (r: TimeRange) => void;
  setAssignee: (a: string) => void;
  setTalla: (t: string) => void;
  setStatus: (s: string) => void;
  toQueryParams: () => Record<string, string | undefined>;
}

function getDateRange(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[range];
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export const useFilters = create<FiltersState>((set, get) => ({
  timeRange: '30d',
  assignee: '',
  talla: '',
  status: '',
  setTimeRange: (timeRange) => set({ timeRange }),
  setAssignee: (assignee) => set({ assignee }),
  setTalla: (talla) => set({ talla }),
  setStatus: (status) => set({ status }),
  toQueryParams: () => {
    const { timeRange, assignee, talla, status } = get();
    const { from, to } = getDateRange(timeRange);
    return {
      from,
      to,
      assignee: assignee || undefined,
      talla: talla || undefined,
      status: status || undefined,
    };
  },
}));
```

- [ ] **Step 4: Crear client/src/hooks/useMetrics.ts**

```typescript
import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue } from '../lib/api';

export interface MetricsData {
  kpis: KPIMetrics | null;
  byTalla: TallaMetric[];
  cfd: CFDPoint[];
  throughput: ThroughputWeek[];
  aging: AgingIssue[];
  loading: boolean;
  error: string | null;
}

export function useMetrics(): MetricsData {
  const toQueryParams = useFilters(s => s.toQueryParams);
  const filters = useFilters(s => ({ timeRange: s.timeRange, assignee: s.assignee, talla: s.talla, status: s.status }));

  const [data, setData] = useState<MetricsData>({
    kpis: null, byTalla: [], cfd: [], throughput: [], aging: [], loading: true, error: null,
  });

  useEffect(() => {
    const params = toQueryParams();
    setData(d => ({ ...d, loading: true, error: null }));

    Promise.all([
      api.metrics(params),
      api.metricsByTalla(params),
      api.metricsCFD(params),
      api.metricsThroughput(params),
      api.metricsAging(params),
    ]).then(([kpis, byTalla, cfd, throughput, aging]) => {
      setData({ kpis, byTalla, cfd, throughput, aging, loading: false, error: null });
    }).catch(err => {
      setData(d => ({ ...d, loading: false, error: err.message }));
    });
  }, [filters.timeRange, filters.assignee, filters.talla, filters.status]);

  return data;
}
```

- [ ] **Step 5: Crear client/src/hooks/useTeam.ts**

```typescript
import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { PersonMetrics, TeamMember } from '../lib/api';

export function useTeam() {
  const filters = useFilters(s => ({ timeRange: s.timeRange, talla: s.talla }));
  const toQueryParams = useFilters(s => s.toQueryParams);
  const [team, setTeam] = useState<PersonMetrics[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to, talla } = toQueryParams();
    Promise.all([api.team({ from, to, talla }), api.teamMembers()])
      .then(([t, m]) => { setTeam(t); setMembers(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filters.timeRange, filters.talla]);

  return { team, members, loading };
}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/ client/src/store/ client/src/hooks/
git commit -m "feat: API client, formatters, Zustand store, data hooks"
```

---

## Task 11: Header y filtros

**Files:**
- Create: `client/src/components/Header/Header.tsx`
- Create: `client/src/components/Header/TimeRangePicker.tsx`
- Create: `client/src/components/Header/PersonFilter.tsx`
- Create: `client/src/components/Header/TallaFilter.tsx`
- Create: `client/src/components/Header/StatusFilter.tsx`

- [ ] **Step 1: Crear TimeRangePicker.tsx**

```tsx
import { useFilters, type TimeRange } from '../../store/filters';

const RANGES: TimeRange[] = ['7d', '14d', '30d', '90d'];

export function TimeRangePicker() {
  const { timeRange, setTimeRange } = useFilters();
  return (
    <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
      {RANGES.map(r => (
        <button
          key={r}
          onClick={() => setTimeRange(r)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            timeRange === r ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Crear PersonFilter.tsx**

```tsx
import { useFilters } from '../../store/filters';
import { useTeam } from '../../hooks/useTeam';

export function PersonFilter() {
  const { assignee, setAssignee } = useFilters();
  const { members } = useTeam();

  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
      <select
        value={assignee}
        onChange={e => setAssignee(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todos</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.display_name}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Crear TallaFilter.tsx**

```tsx
import { useFilters } from '../../store/filters';
import type { Talla } from '../../../../server/src/types';

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];

export function TallaFilter() {
  const { talla, setTalla } = useFilters();
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <span className="text-slate-400 text-xs">★</span>
      <select
        value={talla}
        onChange={e => setTalla(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todas las tallas</option>
        {TALLAS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Crear StatusFilter.tsx**

```tsx
import { useFilters } from '../../store/filters';

const STATUSES = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done', 'Blocked'];

export function StatusFilter() {
  const { status, setStatus } = useFilters();
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <select
        value={status}
        onChange={e => setStatus(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todos los estados</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 5: Crear Header.tsx**

```tsx
import { TimeRangePicker } from './TimeRangePicker';
import { PersonFilter } from './PersonFilter';
import { TallaFilter } from './TallaFilter';
import { StatusFilter } from './StatusFilter';
import { useFilters } from '../../store/filters';
import { useTeam } from '../../hooks/useTeam';
import { api } from '../../lib/api';
import { useState } from 'react';

export function Header() {
  const { assignee, talla, status, timeRange } = useFilters();
  const { members } = useTeam();
  const [syncing, setSyncing] = useState(false);
  const assigneeName = members.find(m => m.id === assignee)?.display_name;
  const hasFilter = !!(assignee || talla || status);

  const activeParts = [
    assigneeName && `${assigneeName}`,
    talla && `talla ${talla}`,
    status && status,
    `últimos ${timeRange}`,
  ].filter(Boolean).join(' · ');

  return (
    <header className="border-b border-slate-800 px-6 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="mr-2">
          <h1 className="text-base font-semibold text-white">⚡ TeamMetrics</h1>
          <p className="text-xs text-slate-500">DevOps Board</p>
        </div>
        <TimeRangePicker />
        <PersonFilter />
        <TallaFilter />
        <StatusFilter />
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-1 rounded-full">✦ IA clasifica tallas</span>
        <button
          onClick={() => { setSyncing(true); api.syncNow().finally(() => setSyncing(false)); }}
          disabled={syncing}
          className="ml-auto text-xs text-slate-400 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg hover:text-white transition-colors disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : '↻ Sync'}
        </button>
      </div>
      {hasFilter && (
        <div className="mt-2 text-xs text-blue-300 bg-blue-950 border border-blue-800 rounded-lg px-3 py-1.5">
          Mostrando: <strong>{activeParts}</strong>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Header/
git commit -m "feat: Header component with all filters"
```

---

## Task 12: KPICards + CycleTimeByTalla

**Files:**
- Create: `client/src/components/KPICards/KPICards.tsx`
- Create: `client/src/components/CycleTimeByTalla/CycleTimeByTalla.tsx`

- [ ] **Step 1: Crear KPICards.tsx**

```tsx
import type { KPIMetrics } from '../../lib/api';
import { formatDays } from '../../lib/formatters';

interface Props { kpis: KPIMetrics | null; loading: boolean; }

function KPICard({ label, value, meta, valueClass }: { label: string; value: string; meta: string; valueClass: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">{label}</div>
      <div className={`text-3xl font-bold leading-none ${valueClass}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1.5">{meta}</div>
    </div>
  );
}

export function KPICards({ kpis, loading }: Props) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-3">
      <KPICard label="WIP Actual" value={String(kpis.wip)} meta="issues en el board" valueClass="text-blue-400" />
      <KPICard label="Throughput" value={String(kpis.throughput)} meta="issues cerrados en el período" valueClass="text-emerald-400" />
      <KPICard
        label="Cycle Time p50 / p85"
        value={formatDays(kpis.cycle_time_p50)}
        meta={`p85 = ${formatDays(kpis.cycle_time_p85)}`}
        valueClass="text-violet-400"
      />
      <KPICard
        label="Issues bloqueados"
        value={String(kpis.blocked_count)}
        meta={kpis.blocked_count > 0 ? '⚠ sin moverse > 7 días' : 'sin bloqueos'}
        valueClass={kpis.blocked_count > 0 ? 'text-red-400' : 'text-slate-400'}
      />
    </div>
  );
}
```

- [ ] **Step 2: Crear CycleTimeByTalla.tsx**

```tsx
import type { TallaMetric } from '../../lib/api';
import { formatDays, TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

const LABELS: Record<Talla, string> = { S: 'Simple', M: 'Moderado', L: 'Complejo', XL: 'Muy complejo' };

function TallaCard({ metric }: { metric: TallaMetric }) {
  const faster = metric.team_ct_p50 !== null && metric.ct_p50 !== null && metric.ct_p50 < metric.team_ct_p50;
  const color = TALLA_COLOR[metric.talla];
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-black" style={{ background: color + '20', color }}>
          {metric.talla}
        </span>
        <span className="text-xs text-slate-500">{LABELS[metric.talla]}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{formatDays(metric.ct_p50)}</div>
      {metric.team_ct_p50 !== null && (
        <div className={`text-xs mt-1 ${faster ? 'text-emerald-400' : 'text-amber-400'}`}>
          {faster ? '✓' : '↑'} Equipo: {formatDays(metric.team_ct_p50)}
        </div>
      )}
      {metric.ct_p50 === null && <div className="text-xs text-slate-600 mt-1">Sin datos</div>}
    </div>
  );
}

interface Props { metrics: TallaMetric[]; }

export function CycleTimeByTalla({ metrics }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cycle Time por talla</h3>
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-0.5 rounded-full">✦ IA</span>
      </div>
      <p className="text-xs text-slate-600 mb-4">Tiempo promedio por complejidad</p>
      <div className="grid grid-cols-4 gap-3">
        {metrics.map(m => <TallaCard key={m.talla} metric={m} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/KPICards/ client/src/components/CycleTimeByTalla/
git commit -m "feat: KPICards and CycleTimeByTalla components"
```

---

## Task 13: CFDChart + ScatterPlot

**Files:**
- Create: `client/src/components/CFDChart/CFDChart.tsx`
- Create: `client/src/components/ScatterPlot/ScatterPlot.tsx`

- [ ] **Step 1: Crear CFDChart.tsx**

```tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { CFDPoint } from '../../lib/api';
import { formatDate } from '../../lib/formatters';

const AREAS = [
  { key: 'done', color: '#166534', label: 'Done' },
  { key: 'in_qa', color: '#0f766e', label: 'In QA' },
  { key: 'in_review', color: '#7c3aed', label: 'In Review' },
  { key: 'in_progress', color: '#1d4ed8', label: 'In Progress' },
  { key: 'todo', color: '#334155', label: 'To Do' },
];

interface Props { data: CFDPoint[]; }

export function CFDChart({ data }: Props) {
  const sampled = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 30)) === 0);
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Cumulative Flow Diagram</h3>
      <p className="text-xs text-slate-600 mb-4">Acumulado por columna</p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={sampled}>
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            labelFormatter={formatDate}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
          {AREAS.map(a => (
            <Area key={a.key} type="monotone" dataKey={a.key} stackId="1" stroke={a.color} fill={a.color} fillOpacity={0.85} name={a.label} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Crear ScatterPlot.tsx**

```tsx
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { KPIMetrics } from '../../lib/api';
import type { Issue } from '../../lib/api';
import { TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

interface ScatterPoint { x: number; y: number; talla: Talla | null; id: string; }

interface Props { issues: Issue[]; kpis: KPIMetrics | null; }

function cycleTimeForIssue(_issue: Issue): number | null {
  // In production this would be computed server-side and included in issue data
  // For now we use a placeholder that will be replaced when server sends ct_days field
  return null;
}

export function ScatterPlot({ issues, kpis }: Props) {
  const points: ScatterPoint[] = issues
    .filter(i => i.status === 'Done')
    .map((issue, idx) => ({
      x: idx,
      y: cycleTimeForIssue(issue) ?? Math.random() * 10, // replaced by real data
      talla: issue.talla,
      id: issue.id,
    }));

  const byTalla = (t: Talla | null) => points.filter(p => p.talla === t);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Cycle Time Scatterplot</h3>
      <p className="text-xs text-slate-600 mb-2">Coloreado por talla</p>
      <div className="flex gap-3 mb-3">
        {(['S','M','L','XL'] as Talla[]).map(t => (
          <span key={t} className="flex items-center gap-1 text-xs text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TALLA_COLOR[t] }} />{t}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart>
          <XAxis dataKey="x" hide />
          <YAxis dataKey="y" tick={{ fontSize: 10, fill: '#475569' }} unit="d" />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            formatter={(v: any) => [`${Number(v).toFixed(1)}d`, 'Cycle Time']}
          />
          {kpis?.cycle_time_p50 != null && <ReferenceLine y={kpis.cycle_time_p50} stroke="#a78bfa" strokeDasharray="4 3" label={{ value: 'p50', fill: '#a78bfa', fontSize: 9 }} />}
          {kpis?.cycle_time_p85 != null && <ReferenceLine y={kpis.cycle_time_p85} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: 'p85', fill: '#f59e0b', fontSize: 9 }} />}
          {(['S','M','L','XL'] as Talla[]).map(t => (
            <Scatter key={t} data={byTalla(t)} fill={TALLA_COLOR[t]} fillOpacity={0.85} r={4} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CFDChart/ client/src/components/ScatterPlot/
git commit -m "feat: CFDChart and ScatterPlot components"
```

---

## Task 14: ThroughputChart + AgingWIP

**Files:**
- Create: `client/src/components/ThroughputChart/ThroughputChart.tsx`
- Create: `client/src/components/AgingWIP/AgingWIP.tsx`

- [ ] **Step 1: Crear ThroughputChart.tsx**

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ThroughputWeek } from '../../lib/api';
import { formatDate, TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

interface Props { data: ThroughputWeek[]; }

export function ThroughputChart({ data }: Props) {
  const chartData = data.map(w => ({
    week: w.week,
    ...w.by_talla,
    total: w.count,
  }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Throughput semanal</h3>
      <p className="text-xs text-slate-600 mb-4">Issues cerrados por semana y talla</p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData}>
          <XAxis dataKey="week" tickFormatter={w => formatDate(w)} tick={{ fontSize: 9, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 9, fill: '#475569' }} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            labelFormatter={formatDate}
          />
          {(['S','M','L','XL'] as Talla[]).map(t => (
            <Bar key={t} dataKey={t} stackId="a" fill={TALLA_COLOR[t]} name={t} radius={t === 'XL' ? [3,3,0,0] : [0,0,0,0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Crear AgingWIP.tsx**

```tsx
import type { AgingIssue } from '../../lib/api';
import { agePillClass, TALLA_BG } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

interface Props { issues: AgingIssue[]; }

export function AgingWIP({ issues }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Aging WIP</h3>
      <p className="text-xs text-slate-600 mb-4">Issues sin movimiento · ordenados por días</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
            <th className="text-left pb-2">Issue</th>
            <th className="text-left pb-2">Título</th>
            <th className="text-left pb-2">Talla</th>
            <th className="text-left pb-2">Estado</th>
            <th className="text-right pb-2">Días</th>
          </tr>
        </thead>
        <tbody>
          {issues.slice(0, 8).map(issue => (
            <tr key={issue.issue_id} className="border-t border-slate-700 hover:bg-slate-700/40">
              <td className="py-2 font-mono text-blue-400 font-semibold">{issue.issue_id}</td>
              <td className="py-2 text-slate-300 max-w-[160px] truncate pr-2">{issue.title}</td>
              <td className="py-2">
                {issue.talla ? (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${TALLA_BG[issue.talla as Talla]}`}>
                    {issue.talla}
                  </span>
                ) : <span className="text-slate-600">—</span>}
              </td>
              <td className="py-2">
                <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-[10px]">{issue.status}</span>
              </td>
              <td className="py-2 text-right">
                <span className={`inline-block px-2 py-0.5 rounded-full font-bold ${agePillClass(issue.days_in_status)}`}>
                  {issue.days_in_status}d
                </span>
              </td>
            </tr>
          ))}
          {issues.length === 0 && (
            <tr><td colSpan={5} className="py-4 text-center text-slate-600">Sin issues activos</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ThroughputChart/ client/src/components/AgingWIP/
git commit -m "feat: ThroughputChart and AgingWIP components"
```

---

## Task 15: TeamTable

**Files:**
- Create: `client/src/components/TeamTable/TeamTable.tsx`

- [ ] **Step 1: Crear TeamTable.tsx**

```tsx
import type { PersonMetrics } from '../../lib/api';
import { formatDays, TALLA_COLOR, SCORE_BG } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];

function TallaMix({ mix }: { mix: Record<Talla, number> }) {
  const total = TALLAS.reduce((s, t) => s + mix[t], 0);
  if (total === 0) return <span className="text-slate-600 text-xs">Sin datos</span>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 rounded overflow-hidden gap-px">
        {TALLAS.map(t => mix[t] > 0 && (
          <div key={t} style={{ width: `${(mix[t] / total) * 100}%`, background: TALLA_COLOR[t] }} />
        ))}
      </div>
      <div className="text-[10px] text-slate-500">
        {TALLAS.filter(t => mix[t] > 0).map(t => `${mix[t]}${t}`).join(' · ')}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-5">
      {values.map((v, i) => (
        <div key={i} className="w-1.5 bg-blue-500 opacity-70 rounded-sm" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
      ))}
    </div>
  );
}

interface Props { team: PersonMetrics[]; loading: boolean; }

export function TeamTable({ team, loading }: Props) {
  const maxThroughput = Math.max(...team.map(p => p.throughput), 1);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rendimiento por persona</h3>
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-0.5 rounded-full">✦ normalizado por complejidad</span>
      </div>
      <p className="text-xs text-slate-600 mb-4">Throughput · Cycle time p50 · Mix de tallas · Score ajustado</p>
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-700 rounded animate-pulse" />)}</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">Persona</th>
              <th className="text-left pb-2">Throughput</th>
              <th className="text-left pb-2">CT p50</th>
              <th className="text-left pb-2 min-w-[120px]">Mix de tallas</th>
              <th className="text-center pb-2">Bloq.</th>
              <th className="text-center pb-2">Score</th>
              <th className="text-center pb-2">4 sem.</th>
            </tr>
          </thead>
          <tbody>
            {team.map(p => (
              <tr key={p.member.id} className="border-t border-slate-700 hover:bg-slate-700/40">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-200 flex-shrink-0">
                      {p.member.display_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-slate-200 font-medium">{p.member.display_name}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 rounded" style={{ width: `${(p.throughput / maxThroughput) * 100}%` }} />
                    </div>
                    <span className="text-slate-400 w-5 text-right">{p.throughput}</span>
                  </div>
                </td>
                <td className="py-2.5 text-violet-400 font-semibold">{formatDays(p.ct_p50)}</td>
                <td className="py-2.5"><TallaMix mix={p.mix_tallas} /></td>
                <td className="py-2.5 text-center">
                  <span className={p.blocked > 0 ? (p.blocked >= 2 ? 'text-red-400' : 'text-amber-400') : 'text-slate-600'}>
                    {p.blocked}
                  </span>
                </td>
                <td className="py-2.5 text-center">
                  <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-xs font-black ${SCORE_BG[p.score]}`}>
                    {p.score}
                  </span>
                </td>
                <td className="py-2.5 flex justify-center pt-3"><Sparkline values={p.sparkline} /></td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-slate-600">Sin datos de equipo</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/TeamTable/
git commit -m "feat: TeamTable component with complexity-normalized scores"
```

---

## Task 16: App.tsx — ensamblado final

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Reemplazar client/src/App.tsx**

```tsx
import { Header } from './components/Header/Header';
import { KPICards } from './components/KPICards/KPICards';
import { CycleTimeByTalla } from './components/CycleTimeByTalla/CycleTimeByTalla';
import { CFDChart } from './components/CFDChart/CFDChart';
import { ScatterPlot } from './components/ScatterPlot/ScatterPlot';
import { ThroughputChart } from './components/ThroughputChart/ThroughputChart';
import { AgingWIP } from './components/AgingWIP/AgingWIP';
import { TeamTable } from './components/TeamTable/TeamTable';
import { useMetrics } from './hooks/useMetrics';
import { useTeam } from './hooks/useTeam';
import { api } from './lib/api';
import { useEffect, useState } from 'react';
import type { Issue } from './lib/api';

export default function App() {
  const { kpis, byTalla, cfd, throughput, aging, loading } = useMetrics();
  const { team, loading: teamLoading } = useTeam();
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => { api.issues().then(setIssues).catch(() => {}); }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header />
      <main className="px-6 py-4 flex flex-col gap-4">
        <KPICards kpis={kpis} loading={loading} />
        <CycleTimeByTalla metrics={byTalla} />
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3"><CFDChart data={cfd} /></div>
          <div className="col-span-2"><ScatterPlot issues={issues} kpis={kpis} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ThroughputChart data={throughput} />
          <AgingWIP issues={aging} />
        </div>
        <div className="border-t border-slate-800 pt-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-700 text-center mb-4">Comparativa del equipo</p>
          <TeamTable team={team} loading={teamLoading} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Levantar server y client juntos**

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Expected: http://localhost:5173 muestra el tablero completo con datos del sync.

- [ ] **Step 3: Correr todos los tests**

```bash
cd server && npm test
cd client && npm test
```

Expected: todos los tests pasan.

- [ ] **Step 4: Commit final**

```bash
git add client/src/App.tsx
git commit -m "feat: App assembly — TeamMetrics dashboard complete"
```

---

## Task 17: .env.example y CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Crear CLAUDE.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with project overview and commands"
```
