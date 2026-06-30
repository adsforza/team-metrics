# TeamMetrics Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native iOS + Android Expo app that shows the same metrics as the web dashboard using locally synced SQLite data and a configurable server endpoint.

**Architecture:** Independent Expo project at `mobile/` inside the monorepo. Expo Router with 5 bottom tabs. Data stored in `expo-sqlite`, synced manually on demand from the Express server's REST endpoints. Settings screen persists the base URL in AsyncStorage.

**Tech Stack:** Expo SDK 52 + TypeScript, Expo Router v4, React Native StyleSheet with a shared color theme (`lib/theme.ts`), `@expo/vector-icons` Feather icons (bundled with Expo), Victory Native (Skia) for charts, Zustand v5, expo-sqlite v14, AsyncStorage.

> **Note on Chakra UI:** `@chakra-ui/native` is an early-stage package; this plan achieves the identical Chakra dark-mode aesthetic using React Native StyleSheet + a shared color palette, avoiding unstable dependencies. The visual result matches the approved mockup exactly.

---

## File map

```
mobile/
├── app/
│   ├── _layout.tsx              ← root: DB init, StatusBar
│   └── (tabs)/
│       ├── _layout.tsx          ← 5 Tabs with Feather icons
│       ├── index.tsx            ← Tab Inicio
│       ├── equipo.tsx           ← Tab Equipo
│       ├── issues.tsx           ← Tab Issues
│       ├── analisis.tsx         ← Tab Análisis
│       └── ajustes.tsx          ← Tab Ajustes
├── components/
│   ├── SyncHeader.tsx           ← shared header with sync button
│   ├── EmptyState.tsx           ← "no data, tap Sync" placeholder
│   ├── KPICard.tsx
│   ├── ComparisonWidget.tsx
│   ├── ScorecardRow.tsx
│   ├── WipRiskCard.tsx
│   ├── AgingIssueRow.tsx
│   ├── BottleneckRow.tsx
│   └── ForecastCard.tsx
├── hooks/
│   ├── useKPIs.ts
│   ├── useTeam.ts
│   ├── useIssues.ts
│   └── useAnalysis.ts
├── store/
│   ├── syncStore.ts             ← loading, lastSyncedAt, error
│   └── filterStore.ts           ← assignee, talla (persisted)
├── lib/
│   ├── types.ts                 ← copy of server/src/types.ts
│   ├── theme.ts                 ← color palette + shared styles
│   ├── api.ts                   ← fetch wrapper + base URL helper
│   ├── db.ts                    ← SQLite schema + read helpers
│   └── sync.ts                  ← fetchAll() + writeToDb()
├── __tests__/
│   ├── api.test.ts
│   ├── db.test.ts
│   └── sync.test.ts
├── app.json
├── babel.config.js
├── package.json
└── tsconfig.json
```

---

### Task 1: Scaffold — Expo project + deps + tab bar skeleton

**Files:**
- Create: `mobile/` (full Expo project via CLI)
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/app/(tabs)/equipo.tsx`
- Create: `mobile/app/(tabs)/issues.tsx`
- Create: `mobile/app/(tabs)/analisis.tsx`
- Create: `mobile/app/(tabs)/ajustes.tsx`

- [ ] **Step 1: Create the Expo project from the monorepo root**

```bash
cd /path/to/team-metrics
npx create-expo-app@latest mobile --template tabs
```

This creates `mobile/` with Expo Router + 2 example tabs. We'll replace the tab content.

- [ ] **Step 2: Install additional dependencies**

```bash
cd mobile
npx expo install expo-sqlite @react-native-async-storage/async-storage \
  react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-screens \
  victory-native react-native-svg

npm install zustand
```

- [ ] **Step 3: Add jest testing dependencies**

```bash
npm install --save-dev jest jest-expo @testing-library/react-native @types/jest
```

Add to `mobile/package.json` under `"scripts"`:
```json
"test": "jest"
```

Add jest config in `mobile/package.json`:
```json
"jest": {
  "preset": "jest-expo",
  "setupFilesAfterFramework": [],
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)"
  ]
}
```

- [ ] **Step 4: Write `mobile/app/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { getDb } from '../lib/db';

export default function RootLayout() {
  useEffect(() => {
    getDb().catch(console.error);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
```

- [ ] **Step 5: Write `mobile/app/(tabs)/_layout.tsx`**

```tsx
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../../lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

function tabIcon(name: FeatherName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Feather name={name} size={size} color={color} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSubtle,
        tabBarStyle: {
          backgroundColor: Colors.bgMuted,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
        },
        headerStyle: { backgroundColor: Colors.bg },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontWeight: '600' },
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Inicio', tabBarIcon: tabIcon('home') }}
      />
      <Tabs.Screen
        name="equipo"
        options={{ title: 'Equipo', tabBarIcon: tabIcon('users') }}
      />
      <Tabs.Screen
        name="issues"
        options={{ title: 'Issues', tabBarIcon: tabIcon('file-text') }}
      />
      <Tabs.Screen
        name="analisis"
        options={{ title: 'Análisis', tabBarIcon: tabIcon('bar-chart-2') }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{ title: 'Ajustes', tabBarIcon: tabIcon('settings') }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 6: Write placeholder screens (same structure for all 5)**

`mobile/app/(tabs)/index.tsx`:
```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../lib/theme';

export default function InicioScreen() {
  return (
    <View style={s.container}>
      <Text style={s.text}>Inicio — próximamente</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { color: Colors.textMuted },
});
```

Repeat for `equipo.tsx`, `issues.tsx`, `analisis.tsx`, `ajustes.tsx` — same structure, different label text.

- [ ] **Step 7: Verify the app starts**

```bash
npx expo start
```

Press `i` for iOS simulator or `a` for Android emulator. Expected: app opens with 5 tabs in the bottom bar, each showing its placeholder text.

- [ ] **Step 8: Delete the boilerplate files created by the template**

```bash
rm -rf mobile/app/(tabs)/two.tsx mobile/components/ mobile/constants/ mobile/hooks/useColorScheme* mobile/hooks/useThemeColor*
```

- [ ] **Step 9: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): scaffold Expo project with 5-tab layout"
```

---

### Task 2: Foundation — `lib/theme.ts`, `lib/types.ts`, `lib/api.ts`

**Files:**
- Create: `mobile/lib/theme.ts`
- Create: `mobile/lib/types.ts`
- Create: `mobile/lib/api.ts`
- Create: `mobile/__tests__/api.test.ts`

- [ ] **Step 1: Write `mobile/lib/theme.ts`**

```ts
import { StyleSheet } from 'react-native';

export const Colors = {
  bg: '#0f172a',
  bgCard: '#1e293b',
  bgMuted: '#171923',
  border: '#2d3748',
  text: '#F7FAFC',
  textMuted: '#94a3b8',
  textSubtle: '#4A5568',
  primary: '#3182CE',
  primaryLight: '#63B3ED',
  success: '#68D391',
  warning: '#F6AD55',
  error: '#FC8181',
} as const;

export const Typography = StyleSheet.create({
  label: { fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8 },
  body: { fontSize: 13, color: Colors.text },
  bodyMuted: { fontSize: 13, color: Colors.textMuted },
  heading: { fontSize: 16, fontWeight: '700', color: Colors.text },
  number: { fontSize: 28, fontWeight: '700', color: Colors.text, lineHeight: 32 },
  numberSmall: { fontSize: 20, fontWeight: '700', color: Colors.textMuted },
});

export const Card = StyleSheet.create({
  base: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
});
```

- [ ] **Step 2: Write `mobile/lib/types.ts`**

Exact copy of `server/src/types.ts`. Copy the file verbatim:

```bash
cp ../server/src/types.ts mobile/lib/types.ts
```

Then remove the lines that don't apply to mobile (FilterParams, SyncLog, Transition — keep everything else). Final file:

```ts
export type Talla = 'S' | 'M' | 'L' | 'XL';

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
  ct_days: number | null;
}

export interface TeamMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface KPIMetrics {
  wip: number;
  throughput: number;
  cycle_time_p50: number | null;
  cycle_time_p85: number | null;
  blocked_count: number;
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

export type Trend = 'up' | 'down' | 'flat';
export type Improving = 'better' | 'worse' | 'steady';

export interface DimensionValue {
  value: number | null;
  previous: number | null;
  trend: Trend;
  improving: Improving;
}

export interface DimensionContext {
  min: number;
  median: number;
  max: number;
}

export interface ScorecardDimensions {
  delivery: DimensionValue;
  predictability: DimensionValue;
  focus: DimensionValue;
  flow: DimensionValue;
}

export interface PersonScorecard extends ScorecardDimensions {
  member: TeamMember;
}

export interface TeamScorecardResponse {
  team: ScorecardDimensions;
  members: PersonScorecard[];
  context: {
    delivery: DimensionContext;
    predictability: DimensionContext;
    focus: DimensionContext;
    flow: DimensionContext;
  };
}

export interface ForecastConfidenceDate { days: number; date: string }
export interface ForecastBin { x: number; count: number }

export interface ForecastWhen {
  conf50: ForecastConfidenceDate;
  conf85: ForecastConfidenceDate;
  conf95: ForecastConfidenceDate;
  histogram: ForecastBin[];
}

export interface ForecastHowMany {
  conf50: number;
  conf85: number;
  conf95: number;
  histogram: ForecastBin[];
}

export interface ForecastResult {
  items: number;
  horizonDays: number;
  lookbackDays: number;
  trials: number;
  totalThroughput: number;
  insufficientData: boolean;
  when: ForecastWhen | null;
  howMany: ForecastHowMany | null;
}

export type WipRiskLevel = 'en_riesgo' | 'excedido';

export interface WipRiskItem {
  issue_id: string;
  title: string;
  talla: Talla;
  status: string;
  assignee_id: string | null;
  age_days: number;
  limit_days: number;
  ratio: number;
  level: WipRiskLevel;
}

export interface TallaLimit {
  talla: Talla;
  limit_days: number | null;
  sample_count: number;
}

export interface WipRiskResult {
  lookbackDays: number;
  limits: TallaLimit[];
  items: WipRiskItem[];
  counts: { en_riesgo: number; excedido: number; sin_limite: number };
}

export type BottleneckScore = 'crítico' | 'alto' | 'medio' | 'normal';

export interface BottleneckTopIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  days_in_state: number;
}

export interface BottleneckTallaBreakdown {
  talla: Talla;
  avg_days: number;
  count: number;
}

export interface BottleneckWeekPoint {
  week: string;
  avg_days: number;
}

export interface BottleneckStateDetail {
  p85_days: number | null;
  pct_of_wip: number;
  trend_pct: number | null;
  trend: BottleneckWeekPoint[];
  top_issues: BottleneckTopIssue[];
  by_talla: BottleneckTallaBreakdown[];
}

export interface BottleneckState {
  status: string;
  queue_size: number;
  avg_days: number | null;
  score: BottleneckScore;
  detail: BottleneckStateDetail;
}

export interface BottleneckResult {
  lookbackWeeks: number;
  total_active: number;
  states: BottleneckState[];
}

export interface ComparisonPeriod {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface ComparisonResult {
  week: string;
  prevWeek: string;
  throughput: ComparisonPeriod;
  wip: ComparisonPeriod;
}
```

- [ ] **Step 3: Write `mobile/lib/api.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL_KEY = 'base_url';
export const DEFAULT_BASE_URL = 'http://localhost:3001';

export async function getBaseUrl(): Promise<string> {
  return (await AsyncStorage.getItem(BASE_URL_KEY)) ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(BASE_URL_KEY, url.trim());
}

export async function apiFetch<T>(path: string): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Write the test**

`mobile/__tests__/api.test.ts`:
```ts
import { BASE_URL_KEY, DEFAULT_BASE_URL } from '../lib/api';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('api constants', () => {
  test('DEFAULT_BASE_URL is localhost:3001', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:3001');
  });

  test('BASE_URL_KEY is a non-empty string', () => {
    expect(typeof BASE_URL_KEY).toBe('string');
    expect(BASE_URL_KEY.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run the test**

```bash
cd mobile && npx jest __tests__/api.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/
git commit -m "feat(mobile): add theme, types and API client"
```

---

### Task 3: Database layer — `lib/db.ts`

**Files:**
- Create: `mobile/lib/db.ts`
- Create: `mobile/__tests__/db.test.ts`

- [ ] **Step 1: Write `mobile/lib/db.ts`**

```ts
import * as SQLite from 'expo-sqlite';
import type {
  KPIMetrics, ThroughputWeek, AgingIssue,
  WipRiskResult, BottleneckResult, ForecastResult,
  ComparisonResult, CFDPoint, Issue,
} from './types';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync('teammetrics.db');
    await initSchema(_db);
  }
  return _db;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kpi_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1,
      wip INTEGER, throughput INTEGER,
      cycle_time_p50 REAL, cycle_time_p85 REAL,
      blocked_count INTEGER, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS throughput_weekly (
      week TEXT PRIMARY KEY, count INTEGER, by_talla TEXT
    );
    CREATE TABLE IF NOT EXISTS scorecard_members (
      member_id TEXT PRIMARY KEY, member_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS aging_issues (
      issue_id TEXT PRIMARY KEY, title TEXT, talla TEXT,
      status TEXT, days_in_status INTEGER, assignee_id TEXT
    );
    CREATE TABLE IF NOT EXISTS wip_risk_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bottleneck_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS forecast_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS comparison_snapshot (
      week TEXT PRIMARY KEY, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS issues_snapshot (
      issue_id TEXT PRIMARY KEY, title TEXT, status TEXT, talla TEXT,
      assignee_id TEXT, ct_days REAL, last_transition_at TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cfd_points (
      date TEXT PRIMARY KEY, todo INTEGER, in_progress INTEGER,
      in_review INTEGER, in_qa INTEGER, done INTEGER
    );
  `);
}

// ── Readers ──────────────────────────────────────────────────────────────────

type KpiRow = Pick<KPIMetrics, 'wip' | 'throughput' | 'cycle_time_p50' | 'cycle_time_p85' | 'blocked_count'>;

export async function readKpi(db: SQLite.SQLiteDatabase): Promise<KpiRow | null> {
  return db.getFirstAsync<KpiRow>(
    'SELECT wip, throughput, cycle_time_p50, cycle_time_p85, blocked_count FROM kpi_snapshot WHERE id = 1'
  );
}

export async function readThroughput(db: SQLite.SQLiteDatabase): Promise<ThroughputWeek[]> {
  const rows = await db.getAllAsync<{ week: string; count: number; by_talla: string }>(
    'SELECT week, count, by_talla FROM throughput_weekly ORDER BY week ASC LIMIT 12'
  );
  return rows.map(r => ({ ...r, by_talla: JSON.parse(r.by_talla) }));
}

export async function readScorecardMembers(db: SQLite.SQLiteDatabase) {
  const rows = await db.getAllAsync<{ member_id: string; member_json: string }>(
    'SELECT member_id, member_json FROM scorecard_members ORDER BY member_id ASC'
  );
  return rows.map(r => JSON.parse(r.member_json));
}

export async function readAgingIssues(db: SQLite.SQLiteDatabase): Promise<AgingIssue[]> {
  return db.getAllAsync<AgingIssue>(
    'SELECT issue_id, title, talla, status, days_in_status, assignee_id FROM aging_issues ORDER BY days_in_status DESC'
  );
}

export async function readWipRisk(db: SQLite.SQLiteDatabase): Promise<WipRiskResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM wip_risk_snapshot WHERE id = 1');
  return row ? JSON.parse(row.result_json) : null;
}

export async function readBottleneck(db: SQLite.SQLiteDatabase): Promise<BottleneckResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM bottleneck_snapshot WHERE id = 1');
  return row ? JSON.parse(row.result_json) : null;
}

export async function readForecast(db: SQLite.SQLiteDatabase): Promise<ForecastResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM forecast_snapshot WHERE id = 1');
  return row ? JSON.parse(row.result_json) : null;
}

export async function readComparison(db: SQLite.SQLiteDatabase): Promise<ComparisonResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>(
    'SELECT result_json FROM comparison_snapshot ORDER BY week DESC LIMIT 1'
  );
  return row ? JSON.parse(row.result_json) : null;
}

export async function readIssues(db: SQLite.SQLiteDatabase): Promise<Issue[]> {
  const rows = await db.getAllAsync<{
    issue_id: string; title: string; status: string; talla: string | null;
    assignee_id: string | null; ct_days: number | null;
    last_transition_at: string | null; created_at: string;
  }>('SELECT * FROM issues_snapshot ORDER BY last_transition_at DESC');
  return rows.map(r => ({
    id: r.issue_id, title: r.title, description: '', status: r.status,
    assignee_id: r.assignee_id, talla: r.talla as any,
    talla_confidence: null, created_at: r.created_at, updated_at: r.created_at,
    synced_at: r.created_at, last_transition_at: r.last_transition_at,
    ct_days: r.ct_days,
  }));
}

export async function readCfd(db: SQLite.SQLiteDatabase): Promise<CFDPoint[]> {
  return db.getAllAsync<CFDPoint>('SELECT * FROM cfd_points ORDER BY date ASC');
}

export async function hasData(db: SQLite.SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM kpi_snapshot WHERE id = 1');
  return row !== null;
}
```

- [ ] **Step 2: Write the test**

`mobile/__tests__/db.test.ts`:
```ts
jest.mock('expo-sqlite', () => {
  const mockDb = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn((fn: () => Promise<void>) => fn()),
  };
  return { openDatabaseAsync: jest.fn().mockResolvedValue(mockDb) };
});

import * as SQLite from 'expo-sqlite';
import { getDb, hasData } from '../lib/db';

describe('getDb', () => {
  test('opens database and runs schema migration', async () => {
    await getDb();
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('teammetrics.db');
  });
});

describe('hasData', () => {
  test('returns false when kpi_snapshot is empty', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    const result = await hasData(db);
    expect(result).toBe(false);
  });

  test('returns true when kpi_snapshot has a row', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce({ id: 1 });
    const result = await hasData(db);
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd mobile && npx jest __tests__/db.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/db.ts mobile/__tests__/db.test.ts
git commit -m "feat(mobile): SQLite schema and read helpers"
```

---

### Task 4: Sync engine + Zustand stores

**Files:**
- Create: `mobile/lib/sync.ts`
- Create: `mobile/store/syncStore.ts`
- Create: `mobile/store/filterStore.ts`
- Create: `mobile/__tests__/sync.test.ts`

- [ ] **Step 1: Write `mobile/lib/sync.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseUrl } from './api';
import { getDb } from './db';
import type {
  KPIMetrics, ThroughputWeek, TeamScorecardResponse, AgingIssue,
  WipRiskResult, BottleneckResult, ForecastResult, ComparisonResult,
  CFDPoint, Issue,
} from './types';

export const LAST_SYNCED_KEY = 'last_synced_at';

export interface SyncError { endpoint: string; message: string }
export interface SyncResult { success: boolean; errors: SyncError[]; syncedAt: string }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function performSync(): Promise<SyncResult> {
  const baseUrl = await getBaseUrl();
  const db = await getDb();
  const errors: SyncError[] = [];
  const syncedAt = new Date().toISOString();

  const [kpi, throughput, team, aging, wipRisk, bottleneck, forecast, comparison, cfd, issues] =
    await Promise.allSettled([
      fetchJson<KPIMetrics>(`${baseUrl}/api/metrics`),
      fetchJson<ThroughputWeek[]>(`${baseUrl}/api/metrics/throughput`),
      fetchJson<TeamScorecardResponse>(`${baseUrl}/api/team`),
      fetchJson<AgingIssue[]>(`${baseUrl}/api/metrics/aging`),
      fetchJson<WipRiskResult>(`${baseUrl}/api/metrics/wip-risk`),
      fetchJson<BottleneckResult>(`${baseUrl}/api/metrics/bottleneck`),
      fetchJson<ForecastResult>(`${baseUrl}/api/metrics/forecast`),
      fetchJson<ComparisonResult>(`${baseUrl}/api/metrics/comparison`),
      fetchJson<CFDPoint[]>(`${baseUrl}/api/metrics/cfd`),
      fetchJson<Issue[]>(`${baseUrl}/api/issues`),
    ]);

  await db.withTransactionAsync(async () => {
    if (kpi.status === 'fulfilled') {
      const k = kpi.value;
      await db.runAsync(
        'INSERT OR REPLACE INTO kpi_snapshot (id, wip, throughput, cycle_time_p50, cycle_time_p85, blocked_count, synced_at) VALUES (1,?,?,?,?,?,?)',
        [k.wip, k.throughput, k.cycle_time_p50, k.cycle_time_p85, k.blocked_count, syncedAt]
      );
    } else { errors.push({ endpoint: '/api/metrics', message: String(kpi.reason) }); }

    if (throughput.status === 'fulfilled') {
      await db.runAsync('DELETE FROM throughput_weekly');
      for (const w of throughput.value) {
        await db.runAsync(
          'INSERT INTO throughput_weekly (week, count, by_talla) VALUES (?,?,?)',
          [w.week, w.count, JSON.stringify(w.by_talla)]
        );
      }
    } else { errors.push({ endpoint: '/api/metrics/throughput', message: String(throughput.reason) }); }

    if (team.status === 'fulfilled') {
      await db.runAsync('DELETE FROM scorecard_members');
      const t = team.value;
      await db.runAsync(
        'INSERT INTO scorecard_members (member_id, member_json, synced_at) VALUES (?,?,?)',
        ['__team__', JSON.stringify({ member: { id: '__team__', display_name: 'Equipo', email: '', avatar_url: null }, ...t.team }), syncedAt]
      );
      for (const m of t.members) {
        await db.runAsync(
          'INSERT INTO scorecard_members (member_id, member_json, synced_at) VALUES (?,?,?)',
          [m.member.id, JSON.stringify(m), syncedAt]
        );
      }
    } else { errors.push({ endpoint: '/api/team', message: String(team.reason) }); }

    if (aging.status === 'fulfilled') {
      await db.runAsync('DELETE FROM aging_issues');
      for (const a of aging.value) {
        await db.runAsync(
          'INSERT INTO aging_issues (issue_id, title, talla, status, days_in_status, assignee_id) VALUES (?,?,?,?,?,?)',
          [a.issue_id, a.title, a.talla, a.status, a.days_in_status, a.assignee_id]
        );
      }
    } else { errors.push({ endpoint: '/api/metrics/aging', message: String(aging.reason) }); }

    for (const [result, endpoint, table] of [
      [wipRisk, '/api/metrics/wip-risk', 'wip_risk_snapshot'],
      [bottleneck, '/api/metrics/bottleneck', 'bottleneck_snapshot'],
      [forecast, '/api/metrics/forecast', 'forecast_snapshot'],
    ] as const) {
      if (result.status === 'fulfilled') {
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (id, result_json, synced_at) VALUES (1,?,?)`,
          [JSON.stringify(result.value), syncedAt]
        );
      } else { errors.push({ endpoint, message: String(result.reason) }); }
    }

    if (comparison.status === 'fulfilled') {
      const c = comparison.value;
      await db.runAsync(
        'INSERT OR REPLACE INTO comparison_snapshot (week, result_json, synced_at) VALUES (?,?,?)',
        [c.week, JSON.stringify(c), syncedAt]
      );
    } else { errors.push({ endpoint: '/api/metrics/comparison', message: String(comparison.reason) }); }

    if (cfd.status === 'fulfilled') {
      await db.runAsync('DELETE FROM cfd_points');
      for (const p of cfd.value) {
        await db.runAsync(
          'INSERT INTO cfd_points (date, todo, in_progress, in_review, in_qa, done) VALUES (?,?,?,?,?,?)',
          [p.date, p.todo, p.in_progress, p.in_review, p.in_qa, p.done]
        );
      }
    } else { errors.push({ endpoint: '/api/metrics/cfd', message: String(cfd.reason) }); }

    if (issues.status === 'fulfilled') {
      await db.runAsync('DELETE FROM issues_snapshot');
      for (const i of issues.value) {
        await db.runAsync(
          'INSERT INTO issues_snapshot (issue_id, title, status, talla, assignee_id, ct_days, last_transition_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
          [i.id, i.title, i.status, i.talla, i.assignee_id, i.ct_days, i.last_transition_at, i.created_at]
        );
      }
    } else { errors.push({ endpoint: '/api/issues', message: String(issues.reason) }); }
  });

  await AsyncStorage.setItem(LAST_SYNCED_KEY, syncedAt);

  return { success: errors.length === 0, errors, syncedAt };
}
```

- [ ] **Step 2: Write `mobile/store/syncStore.ts`**

```ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  errors: SyncError[];
  dataVersion: number;           // incremented after each successful sync → triggers hooks to re-read
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  errors: [],
  dataVersion: 0,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });
    try {
      const result = await performSync();
      set({
        loading: false,
        lastSyncedAt: result.syncedAt,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
      });
    } catch (err) {
      set({
        loading: false,
        errors: [{ endpoint: 'global', message: String(err) }],
      });
    }
  },
}));
```

- [ ] **Step 3: Write `mobile/store/filterStore.ts`**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Talla } from '../lib/types';

interface FilterState {
  assignee: string | null;
  talla: Talla | null;
  setAssignee: (a: string | null) => void;
  setTalla: (t: Talla | null) => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      assignee: null,
      talla: null,
      setAssignee: (assignee) => set({ assignee }),
      setTalla: (talla) => set({ talla }),
    }),
    {
      name: 'tm-filters',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

- [ ] **Step 4: Write the sync test**

`mobile/__tests__/sync.test.ts`:
```ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sqlite', () => {
  const mockDb = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn((fn: () => Promise<void>) => fn()),
  };
  return { openDatabaseAsync: jest.fn().mockResolvedValue(mockDb) };
});

global.fetch = jest.fn();

import { performSync } from '../lib/sync';

const mockKpi = { wip: 5, throughput: 3, cycle_time_p50: 4, cycle_time_p85: 7, blocked_count: 1 };

function mockAllFetch(overrides: Record<string, unknown> = {}) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/api/metrics/throughput')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics/aging'))      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics/wip-risk'))   return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], counts: {}, limits: [], lookbackDays: 84 }) });
    if (url.includes('/api/metrics/bottleneck')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ states: [], total_active: 0, lookbackWeeks: 8 }) });
    if (url.includes('/api/metrics/forecast'))   return Promise.resolve({ ok: true, json: () => Promise.resolve({ insufficientData: true, when: null, howMany: null, items: 0, horizonDays: 14, lookbackDays: 84, trials: 10000, totalThroughput: 0 }) });
    if (url.includes('/api/metrics/comparison')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ week: '2026-06-23', prevWeek: '2026-06-16', throughput: { current: 0, previous: 0, delta: 0, deltaPct: null }, wip: { current: 0, previous: 0, delta: 0, deltaPct: null } }) });
    if (url.includes('/api/metrics/cfd'))        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics'))            return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides['/api/metrics'] ?? mockKpi) });
    if (url.includes('/api/team'))               return Promise.resolve({ ok: true, json: () => Promise.resolve({ team: { delivery: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, predictability: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, focus: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, flow: { value: 1, previous: 1, trend: 'flat', improving: 'steady' } }, members: [], context: { delivery: { min:0,median:1,max:2 }, predictability: { min:0,median:1,max:2 }, focus: { min:0,median:1,max:2 }, flow: { min:0,median:1,max:2 } } }) });
    if (url.includes('/api/issues'))             return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    return Promise.reject(new Error('unmatched URL: ' + url));
  });
}

describe('performSync', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns success when all endpoints respond', async () => {
    mockAllFetch();
    const result = await performSync();
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('records an error for a failing endpoint but continues', async () => {
    mockAllFetch();
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 503 })
    );
    const result = await performSync();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd mobile && npx jest __tests__/sync.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/sync.ts mobile/store/
git commit -m "feat(mobile): sync engine and Zustand stores"
```

---

### Task 5: `SyncHeader` component + Tab Ajustes

**Files:**
- Create: `mobile/components/SyncHeader.tsx`
- Create: `mobile/components/EmptyState.tsx`
- Modify: `mobile/app/(tabs)/ajustes.tsx`

- [ ] **Step 1: Write `mobile/components/EmptyState.tsx`**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';

export function EmptyState() {
  const { sync, loading } = useSyncStore();
  return (
    <View style={s.container}>
      <Feather name="inbox" size={40} color={Colors.textSubtle} />
      <Text style={s.title}>Sin datos</Text>
      <Text style={s.subtitle}>Sincronizá para ver las métricas</Text>
      <TouchableOpacity style={s.button} onPress={sync} disabled={loading}>
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={s.buttonText}>{loading ? 'Sincronizando…' : 'Sincronizar ahora'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  title: { fontSize: 16, fontWeight: '600', color: Colors.text, marginTop: 12 },
  subtitle: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
```

- [ ] **Step 2: Write `mobile/components/SyncHeader.tsx`**

```tsx
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export function SyncHeader() {
  const { sync, loading, lastSyncedAt } = useSyncStore();
  return (
    <View style={s.row}>
      {lastSyncedAt && (
        <Text style={s.timestamp}>sync {timeAgo(lastSyncedAt)}</Text>
      )}
      <TouchableOpacity style={s.button} onPress={sync} disabled={loading}>
        {loading ? (
          <ActivityIndicator size={12} color={Colors.primary} />
        ) : (
          <Feather name="refresh-cw" size={12} color={Colors.primary} />
        )}
        <Text style={s.buttonText}>Sync</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timestamp: { fontSize: 10, color: Colors.textSubtle },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  buttonText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
});
```

- [ ] **Step 3: Mount SyncHeader in the tab layout header**

Modify `mobile/app/(tabs)/_layout.tsx` — import SyncHeader and add to `headerRight`:

```tsx
import { SyncHeader } from '../../components/SyncHeader';
// inside <Tabs screenOptions={{ ... }}>:
// add this to screenOptions:
headerRight: () => <SyncHeader />,
headerRightContainerStyle: { paddingRight: 16 },
```

- [ ] **Step 4: Write `mobile/app/(tabs)/ajustes.tsx`**

```tsx
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Card, Typography } from '../../lib/theme';
import { BASE_URL_KEY, DEFAULT_BASE_URL, setBaseUrl } from '../../lib/api';
import { useSyncStore } from '../../store/syncStore';
import { useFilterStore } from '../../store/filterStore';

const TALLA_OPTIONS = ['S', 'M', 'L', 'XL'] as const;

export default function AjustesScreen() {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const { sync, loading, lastSyncedAt, errors } = useSyncStore();
  const { assignee, talla, setAssignee, setTalla } = useFilterStore();

  useEffect(() => {
    AsyncStorage.getItem(BASE_URL_KEY).then(v => { if (v) setUrl(v); });
  }, []);

  const handleUrlBlur = () => setBaseUrl(url);

  const handleSync = async () => {
    await sync();
    if (errors.length > 0) {
      Alert.alert('Sync parcial', `${errors.length} endpoint(s) fallaron:\n${errors.map(e => e.endpoint).join('\n')}`);
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* Servidor */}
      <Text style={[Typography.label, s.sectionLabel]}>Servidor</Text>
      <View style={Card.base}>
        <Text style={[Typography.label, { marginBottom: 6 }]}>URL base</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          onBlur={handleUrlBlur}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_BASE_URL}
          placeholderTextColor={Colors.textSubtle}
        />
        <Text style={s.hint}>Cambiá la URL para conectar a un servidor con IP pública.</Text>
      </View>

      {/* Sincronización */}
      <Text style={[Typography.label, s.sectionLabel]}>Sincronización</Text>
      <View style={Card.base}>
        <View style={s.syncRow}>
          <View>
            <Text style={Typography.bodyMuted}>Última sync</Text>
            <Text style={s.syncDate}>
              {lastSyncedAt ? fmtDate(lastSyncedAt) : 'Nunca sincronizado'}
            </Text>
          </View>
          <TouchableOpacity style={s.syncButton} onPress={handleSync} disabled={loading}>
            <Feather name="refresh-cw" size={13} color="#fff" />
            <Text style={s.syncButtonText}>{loading ? 'Sincronizando…' : 'Sincronizar'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filtros globales */}
      <Text style={[Typography.label, s.sectionLabel]}>Filtros globales</Text>
      <View style={Card.base}>
        <Text style={[Typography.label, { marginBottom: 6 }]}>Persona</Text>
        <TouchableOpacity
          style={s.selectBox}
          onPress={() => setAssignee(assignee ? null : 'me')}
        >
          <Text style={s.selectText}>{assignee ?? 'Todos'}</Text>
          <Feather name="chevron-down" size={14} color={Colors.textSubtle} />
        </TouchableOpacity>

        <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>Talla</Text>
        <View style={s.tallaRow}>
          {([null, ...TALLA_OPTIONS] as const).map(t => (
            <TouchableOpacity
              key={String(t)}
              style={[s.tallaChip, talla === t && s.tallaChipActive]}
              onPress={() => setTalla(t)}
            >
              <Text style={[s.tallaText, talla === t && s.tallaTextActive]}>
                {t ?? 'Todas'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 8 },
  sectionLabel: { marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: Colors.primaryLight, fontFamily: 'monospace', fontSize: 12,
  },
  hint: { fontSize: 11, color: Colors.textSubtle, marginTop: 6 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  syncDate: { fontSize: 12, color: Colors.textSubtle, marginTop: 2 },
  syncButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  syncButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  selectText: { fontSize: 12, color: Colors.text },
  tallaRow: { flexDirection: 'row', gap: 8 },
  tallaChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
  },
  tallaChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tallaText: { fontSize: 12, color: Colors.textMuted },
  tallaTextActive: { color: '#fff', fontWeight: '600' },
});
```

> **Note:** The person filter in Ajustes uses a placeholder toggle for now. Task 7 (Equipo) adds the full person list from the DB. If you want to wire it up fully here, read `scorecard_members` from the DB and show a picker.

- [ ] **Step 5: Load last sync timestamp on app start**

In `mobile/app/_layout.tsx`, call `loadLastSynced` on mount:

```tsx
import { useSyncStore } from '../store/syncStore';
// inside RootLayout:
const loadLastSynced = useSyncStore(s => s.loadLastSynced);
useEffect(() => {
  getDb().catch(console.error);
  loadLastSynced();
}, []);
```

- [ ] **Step 6: Start the app and verify**

```bash
npx expo start
```

Open in simulator. Navigate to the Ajustes tab. Expected:
- URL field shows `http://localhost:3001`
- Sync button is visible
- Talla chips render (Todas, S, M, L, XL)
- SyncHeader appears in the tab bar header

- [ ] **Step 7: Commit**

```bash
git add mobile/components/ mobile/app/(tabs)/ajustes.tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): SyncHeader, EmptyState and Ajustes tab"
```

---

### Task 6: Tab Inicio — KPIs + comparativa + throughput chart

**Files:**
- Create: `mobile/components/KPICard.tsx`
- Create: `mobile/components/ComparisonWidget.tsx`
- Create: `mobile/hooks/useKPIs.ts`
- Modify: `mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Write `mobile/hooks/useKPIs.ts`**

```ts
import { useEffect, useState } from 'react';
import { getDb, readKpi, readThroughput, readComparison } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { KPIMetrics, ThroughputWeek, ComparisonResult } from '../lib/types';

interface KPIData {
  kpi: KPIMetrics | null;
  throughput: ThroughputWeek[];
  comparison: ComparisonResult | null;
  hasData: boolean;
}

export function useKPIs(): KPIData {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [data, setData] = useState<KPIData>({ kpi: null, throughput: [], comparison: null, hasData: false });

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [kpi, throughput, comparison] = await Promise.all([
        readKpi(db),
        readThroughput(db),
        readComparison(db),
      ]);
      setData({ kpi, throughput, comparison, hasData: kpi !== null });
    })();
  }, [dataVersion]);

  return data;
}
```

- [ ] **Step 2: Write `mobile/components/KPICard.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Card } from '../lib/theme';

interface Props {
  label: string;
  value: number | string | null;
  color?: string;
}

export function KPICard({ label, value, color = Colors.text }: Props) {
  return (
    <View style={Card.base}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, { color }]}>{value ?? '—'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  value: { fontSize: 28, fontWeight: '700', lineHeight: 32 },
});
```

- [ ] **Step 3: Write `mobile/components/ComparisonWidget.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Card, Colors, Typography } from '../lib/theme';
import type { ComparisonResult } from '../lib/types';

function arrow(delta: number) { return delta > 0 ? '↑' : delta < 0 ? '↓' : '→'; }
function deltaColor(delta: number, metric: 'throughput' | 'wip') {
  if (delta === 0) return Colors.textSubtle;
  if (metric === 'throughput') return delta > 0 ? Colors.success : Colors.error;
  return delta > 0 ? Colors.warning : Colors.success;
}

export function ComparisonWidget({ result }: { result: ComparisonResult }) {
  const fmtWeek = (monday: string) => {
    const [y, m, d] = monday.split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    const sun = new Date(y, m - 1, d + 6);
    const fmt = (dt: Date) => dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  };

  return (
    <View style={Card.base}>
      {/* Week band */}
      <View style={s.band}>
        <View style={s.bandLeft}>
          <Text style={s.bandLabel}>Esta semana</Text>
          <Text style={s.bandDate}>{fmtWeek(result.week)}</Text>
        </View>
        <Text style={s.vs}>vs</Text>
        <View style={s.bandRight}>
          <Text style={[s.bandLabel, { color: Colors.textSubtle }]}>Semana anterior</Text>
          <Text style={[s.bandDate, { color: Colors.textMuted }]}>{fmtWeek(result.prevWeek)}</Text>
        </View>
      </View>
      {/* Metrics */}
      <View style={s.metricsRow}>
        {(['throughput', 'wip'] as const).map(metric => {
          const p = result[metric];
          const col = deltaColor(p.delta, metric);
          return (
            <View key={metric} style={s.metricCell}>
              <Text style={s.metricLabel}>{metric === 'throughput' ? 'Throughput' : 'WIP'}</Text>
              <View style={s.metricValueRow}>
                <Text style={s.metricCurrent}>{p.current}</Text>
                <Text style={[s.metricDelta, { color: col }]}>
                  {arrow(p.delta)} {p.delta > 0 ? '+' : ''}{p.delta}
                  {p.deltaPct !== null ? ` (${p.deltaPct}%)` : ''}
                </Text>
                <Text style={s.metricPrev}>{p.previous}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  band: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 10 },
  bandLeft: { flex: 1 },
  bandRight: { flex: 1, alignItems: 'flex-end' },
  bandLabel: { fontSize: 9, color: Colors.primaryLight, textTransform: 'uppercase', letterSpacing: 0.8 },
  bandDate: { fontSize: 12, fontWeight: '600', color: Colors.text, marginTop: 2 },
  vs: { paddingHorizontal: 10, color: Colors.textSubtle, fontSize: 14 },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCell: { flex: 1 },
  metricLabel: { fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  metricCurrent: { fontSize: 24, fontWeight: '700', color: Colors.text },
  metricDelta: { fontSize: 11, fontWeight: '600' },
  metricPrev: { fontSize: 18, fontWeight: '700', color: Colors.textSubtle, marginLeft: 'auto' },
});
```

- [ ] **Step 4: Write `mobile/app/(tabs)/index.tsx`**

```tsx
import { ScrollView, View, Text, StyleSheet, Dimensions } from 'react-native';
import { CartesianChart, Bar } from 'victory-native';
import { Colors, Typography } from '../../lib/theme';
import { KPICard } from '../../components/KPICard';
import { ComparisonWidget } from '../../components/ComparisonWidget';
import { EmptyState } from '../../components/EmptyState';
import { useKPIs } from '../../hooks/useKPIs';

const CHART_WIDTH = Dimensions.get('window').width - 32;

export default function InicioScreen() {
  const { kpi, throughput, comparison, hasData } = useKPIs();

  if (!hasData) return <EmptyState />;

  const chartData = throughput.map(w => ({
    week: w.week.slice(5),  // MM-DD
    count: w.count,
  }));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* KPIs */}
      <View style={s.kpiGrid}>
        <KPICard label="WIP" value={kpi?.wip ?? null} />
        <KPICard label="Throughput" value={kpi?.throughput ?? null} />
        <KPICard
          label="Cycle P50"
          value={kpi?.cycle_time_p50 != null ? `${kpi.cycle_time_p50}d` : null}
        />
        <KPICard
          label="Bloqueados"
          value={kpi?.blocked_count ?? null}
          color={kpi && kpi.blocked_count > 0 ? Colors.error : Colors.text}
        />
      </View>

      {/* Comparativa semanal */}
      {comparison && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Comparativa semanal</Text>
          <ComparisonWidget result={comparison} />
        </>
      )}

      {/* Throughput chart */}
      {chartData.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Throughput semanal</Text>
          <View style={s.chartCard}>
            <CartesianChart
              data={chartData}
              xKey="week"
              yKeys={['count']}
              domainPadding={{ left: 12, right: 12, top: 16 }}
            >
              {({ points, chartBounds }) => (
                <Bar
                  points={points.count}
                  chartBounds={chartBounds}
                  color={Colors.primary}
                  roundedCorners={{ topLeft: 3, topRight: 3 }}
                />
              )}
            </CartesianChart>
          </View>
        </>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { marginTop: 4 },
  chartCard: {
    backgroundColor: Colors.bgCard, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, height: 180,
  },
});
```

- [ ] **Step 5: Verify in simulator**

```bash
npx expo start
```

After syncing from Ajustes, navigate to Inicio. Expected: 4 KPI cards, comparison widget with week dates, bar chart with weekly throughput.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useKPIs.ts mobile/components/KPICard.tsx mobile/components/ComparisonWidget.tsx mobile/app/(tabs)/index.tsx
git commit -m "feat(mobile): tab Inicio con KPIs, comparativa y throughput chart"
```

---

### Task 7: Tab Equipo — scorecard + person filter

**Files:**
- Create: `mobile/components/ScorecardRow.tsx`
- Create: `mobile/hooks/useTeam.ts`
- Modify: `mobile/app/(tabs)/equipo.tsx`

- [ ] **Step 1: Write `mobile/hooks/useTeam.ts`**

```ts
import { useEffect, useState } from 'react';
import { getDb, readScorecardMembers } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { PersonScorecard } from '../lib/types';

export function useTeam() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [members, setMembers] = useState<PersonScorecard[]>([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const rows = await readScorecardMembers(db);
      setMembers(rows);
      setHasData(rows.length > 0);
    })();
  }, [dataVersion]);

  return { members, hasData };
}
```

- [ ] **Step 2: Write `mobile/components/ScorecardRow.tsx`**

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../lib/theme';
import type { PersonScorecard, DimensionValue } from '../lib/types';

function DimCell({ dim }: { dim: DimensionValue }) {
  const color = dim.improving === 'better' ? Colors.success
    : dim.improving === 'worse' ? Colors.error
    : Colors.warning;
  const arrow = dim.trend === 'up' ? '↑' : dim.trend === 'down' ? '↓' : '→';
  return (
    <View style={s.dimCell}>
      <Text style={[s.dimArrow, { color }]}>{arrow}</Text>
      {dim.value != null && <Text style={s.dimValue}>{dim.value.toFixed(0)}</Text>}
    </View>
  );
}

interface Props {
  scorecard: PersonScorecard;
  isTeam?: boolean;
  onPress?: () => void;
}

export function ScorecardRow({ scorecard, isTeam, onPress }: Props) {
  return (
    <TouchableOpacity style={[s.row, isTeam && s.teamRow]} onPress={onPress}>
      <Text style={[s.name, isTeam && s.teamName]} numberOfLines={1}>
        {scorecard.member.display_name}
      </Text>
      <DimCell dim={scorecard.delivery} />
      <DimCell dim={scorecard.predictability} />
      <DimCell dim={scorecard.focus} />
      <DimCell dim={scorecard.flow} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  teamRow: { backgroundColor: Colors.bgMuted },
  name: { flex: 1, fontSize: 12, color: Colors.text },
  teamName: { fontWeight: '700', color: Colors.textMuted },
  dimCell: { width: 44, alignItems: 'center' },
  dimArrow: { fontSize: 14, fontWeight: '700' },
  dimValue: { fontSize: 9, color: Colors.textSubtle, marginTop: 1 },
});
```

- [ ] **Step 3: Write `mobile/app/(tabs)/equipo.tsx`**

```tsx
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { ScorecardRow } from '../../components/ScorecardRow';
import { EmptyState } from '../../components/EmptyState';
import { useTeam } from '../../hooks/useTeam';
import type { PersonScorecard } from '../../lib/types';

const DIMS = ['Entrega', 'Pred.', 'Foco', 'Flujo'];

export default function EquipoScreen() {
  const { members, hasData } = useTeam();

  if (!hasData) return <EmptyState />;

  const team = members.find(m => m.member.id === '__team__') as PersonScorecard | undefined;
  const rest = members.filter(m => m.member.id !== '__team__');

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={Card.base}>
        {/* Header row */}
        <View style={s.headerRow}>
          <Text style={[s.headerCell, s.nameCell]}>Persona</Text>
          {DIMS.map(d => <Text key={d} style={s.headerCell}>{d}</Text>)}
        </View>
        {/* Team aggregate row */}
        {team && <ScorecardRow scorecard={team} isTeam />}
        {/* Member rows */}
        {rest.map(m => <ScorecardRow key={m.member.id} scorecard={m} />)}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerCell: { width: 44, fontSize: 9, color: Colors.textSubtle, textTransform: 'uppercase', textAlign: 'center' },
  nameCell: { flex: 1, width: undefined, textAlign: 'left' },
});
```

- [ ] **Step 4: Verify in simulator after sync**

Expected: table shows "Equipo" row at top, then one row per team member, with ↑/→/↓ indicators in each dimension column.

- [ ] **Step 5: Commit**

```bash
git add mobile/hooks/useTeam.ts mobile/components/ScorecardRow.tsx mobile/app/(tabs)/equipo.tsx
git commit -m "feat(mobile): tab Equipo con scorecard por persona"
```

---

### Task 8: Tab Issues — WIP Risk + Aging WIP

**Files:**
- Create: `mobile/components/WipRiskCard.tsx`
- Create: `mobile/components/AgingIssueRow.tsx`
- Create: `mobile/hooks/useIssues.ts`
- Modify: `mobile/app/(tabs)/issues.tsx`

- [ ] **Step 1: Write `mobile/hooks/useIssues.ts`**

```ts
import { useEffect, useState } from 'react';
import { getDb, readWipRisk, readAgingIssues } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import type { WipRiskResult, AgingIssue } from '../lib/types';

export function useIssues() {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const { assignee, talla } = useFilterStore();
  const [wipRisk, setWipRisk] = useState<WipRiskResult | null>(null);
  const [aging, setAging] = useState<AgingIssue[]>([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [risk, ag] = await Promise.all([readWipRisk(db), readAgingIssues(db)]);
      let filteredRisk = risk;
      let filteredAging = ag;

      if (risk && (assignee || talla)) {
        filteredRisk = {
          ...risk,
          items: risk.items.filter(i =>
            (!assignee || i.assignee_id === assignee) &&
            (!talla || i.talla === talla)
          ),
        };
      }
      if (assignee || talla) {
        filteredAging = ag.filter(i =>
          (!assignee || i.assignee_id === assignee) &&
          (!talla || i.talla === talla)
        );
      }

      setWipRisk(filteredRisk);
      setAging(filteredAging);
      setHasData(risk !== null);
    })();
  }, [dataVersion, assignee, talla]);

  return { wipRisk, aging, hasData };
}
```

- [ ] **Step 2: Write `mobile/components/WipRiskCard.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Card } from '../lib/theme';
import type { WipRiskItem } from '../lib/types';

export function WipRiskCard({ item }: { item: WipRiskItem }) {
  const isExcedido = item.level === 'excedido';
  const badgeColor = isExcedido ? Colors.error : Colors.warning;
  const progress = Math.min(item.ratio, 1.5);

  return (
    <View style={Card.base}>
      <View style={s.header}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <View style={[s.badge, { backgroundColor: badgeColor + '30', borderColor: badgeColor }]}>
          <Text style={[s.badgeText, { color: badgeColor }]}>
            {isExcedido ? 'excedido' : 'en riesgo'}
          </Text>
        </View>
      </View>
      <View style={s.meta}>
        <View style={[s.tallaChip]}>
          <Text style={s.tallaText}>{item.talla}</Text>
        </View>
        <Text style={s.days}>{item.age_days}d / límite {item.limit_days}d</Text>
      </View>
      {/* Progress bar */}
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: badgeColor }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  title: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tallaChip: { backgroundColor: Colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tallaText: { fontSize: 10, color: Colors.textMuted },
  days: { fontSize: 11, color: Colors.textSubtle },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
});
```

- [ ] **Step 3: Write `mobile/components/AgingIssueRow.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import type { AgingIssue } from '../lib/types';

export function AgingIssueRow({ issue }: { issue: AgingIssue }) {
  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.title} numberOfLines={1}>{issue.title}</Text>
        <Text style={s.meta}>{issue.status} · {issue.talla ?? '?'}</Text>
      </View>
      <Text style={s.days}>{issue.days_in_status}d</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  left: { flex: 1 },
  title: { fontSize: 12, color: Colors.text, marginBottom: 2 },
  meta: { fontSize: 10, color: Colors.textSubtle },
  days: { fontSize: 14, fontWeight: '700', color: Colors.textMuted, minWidth: 36, textAlign: 'right' },
});
```

- [ ] **Step 4: Write `mobile/app/(tabs)/issues.tsx`**

```tsx
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Card } from '../../lib/theme';
import { WipRiskCard } from '../../components/WipRiskCard';
import { AgingIssueRow } from '../../components/AgingIssueRow';
import { EmptyState } from '../../components/EmptyState';
import { useIssues } from '../../hooks/useIssues';

export default function IssuesScreen() {
  const { wipRisk, aging, hasData } = useIssues();

  if (!hasData) return <EmptyState />;

  const riskItems = wipRisk?.items ?? [];
  const excedidos = riskItems.filter(i => i.level === 'excedido');
  const enRiesgo = riskItems.filter(i => i.level === 'en_riesgo');

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* WIP en riesgo */}
      <Text style={s.sectionTitle}>
        WIP en riesgo ({riskItems.length})
      </Text>
      {riskItems.length === 0 ? (
        <View style={[Card.base, s.empty]}>
          <Text style={s.emptyText}>Sin issues en riesgo</Text>
        </View>
      ) : (
        <View style={s.cards}>
          {excedidos.map(i => <WipRiskCard key={i.issue_id} item={i} />)}
          {enRiesgo.map(i => <WipRiskCard key={i.issue_id} item={i} />)}
        </View>
      )}

      {/* Aging WIP */}
      <Text style={s.sectionTitle}>Aging WIP ({aging.length})</Text>
      <View style={Card.base}>
        {aging.length === 0 ? (
          <Text style={s.emptyText}>Sin issues sin movimiento</Text>
        ) : (
          aging.map(i => <AgingIssueRow key={i.issue_id} issue={i} />)
        )}
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.text, marginTop: 4 },
  cards: { gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 12, color: Colors.textSubtle },
});
```

- [ ] **Step 5: Verify in simulator**

After sync, navigate to Issues. Expected: WIP risk cards with colored badges and progress bars; Aging WIP list sorted by days descending.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useIssues.ts mobile/components/WipRiskCard.tsx mobile/components/AgingIssueRow.tsx mobile/app/(tabs)/issues.tsx
git commit -m "feat(mobile): tab Issues con WIP Risk y Aging WIP"
```

---

### Task 9: Tab Análisis — Bottleneck + Forecast + CFD + Scatter

**Files:**
- Create: `mobile/components/BottleneckRow.tsx`
- Create: `mobile/components/ForecastCard.tsx`
- Create: `mobile/hooks/useAnalysis.ts`
- Modify: `mobile/app/(tabs)/analisis.tsx`

- [ ] **Step 1: Write `mobile/hooks/useAnalysis.ts`**

```ts
import { useEffect, useState } from 'react';
import { getDb, readBottleneck, readForecast, readCfd, readIssues } from '../lib/db';
import { useSyncStore } from '../store/syncStore';
import type { BottleneckResult, ForecastResult, CFDPoint, Issue } from '../lib/types';

interface AnalysisData {
  bottleneck: BottleneckResult | null;
  forecast: ForecastResult | null;
  cfd: CFDPoint[];
  issues: Issue[];
  hasData: boolean;
}

export function useAnalysis(): AnalysisData {
  const dataVersion = useSyncStore(s => s.dataVersion);
  const [data, setData] = useState<AnalysisData>({ bottleneck: null, forecast: null, cfd: [], issues: [], hasData: false });

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [bottleneck, forecast, cfd, issues] = await Promise.all([
        readBottleneck(db), readForecast(db), readCfd(db), readIssues(db),
      ]);
      setData({ bottleneck, forecast, cfd, issues, hasData: bottleneck !== null });
    })();
  }, [dataVersion]);

  return data;
}
```

- [ ] **Step 2: Write `mobile/components/BottleneckRow.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../lib/theme';
import type { BottleneckState, BottleneckScore } from '../lib/types';

const SCORE_COLOR: Record<BottleneckScore, string> = {
  crítico: Colors.error,
  alto: Colors.warning,
  medio: '#60A5FA',
  normal: Colors.textSubtle,
};

export function BottleneckRow({ state }: { state: BottleneckState }) {
  const color = SCORE_COLOR[state.score];
  const pct = Math.round(state.detail.pct_of_wip * 100);
  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.status}>{state.status}</Text>
        <Text style={s.meta}>{state.queue_size} issues · {state.avg_days != null ? `${state.avg_days.toFixed(1)}d` : '—'}</Text>
        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color }]} />
        </View>
      </View>
      <View style={[s.badge, { backgroundColor: color + '20', borderColor: color }]}>
        <Text style={[s.badgeText, { color }]}>{state.score}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  left: { flex: 1 },
  status: { fontSize: 12, color: Colors.text, marginBottom: 2 },
  meta: { fontSize: 10, color: Colors.textSubtle, marginBottom: 4 },
  barBg: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
});
```

- [ ] **Step 3: Write `mobile/components/ForecastCard.tsx`**

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';
import { CartesianChart, Bar } from 'victory-native';
import { Colors, Card } from '../lib/theme';
import type { ForecastResult } from '../lib/types';

export function ForecastCard({ forecast }: { forecast: ForecastResult }) {
  const [mode, setMode] = useState<'when' | 'howMany'>('when');

  if (forecast.insufficientData) {
    return (
      <View style={[Card.base, s.empty]}>
        <Text style={s.emptyText}>Datos insuficientes para forecast</Text>
      </View>
    );
  }

  const data = mode === 'when'
    ? forecast.when?.histogram ?? []
    : forecast.howMany?.histogram ?? [];

  return (
    <View style={Card.base}>
      <View style={s.toggle}>
        {(['when', 'howMany'] as const).map(m => (
          <TouchableOpacity
            key={m}
            style={[s.toggleBtn, mode === m && s.toggleBtnActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
              {m === 'when' ? '¿Cuándo?' : '¿Cuántos?'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Percentiles */}
      {mode === 'when' && forecast.when && (
        <View style={s.percRow}>
          {[
            { label: 'P50', val: `${forecast.when.conf50.days}d`, color: Colors.success },
            { label: 'P85', val: `${forecast.when.conf85.days}d`, color: Colors.warning },
            { label: 'P95', val: `${forecast.when.conf95.days}d`, color: Colors.error },
          ].map(p => (
            <View key={p.label} style={s.perc}>
              <Text style={s.percLabel}>{p.label}</Text>
              <Text style={[s.percValue, { color: p.color }]}>{p.val}</Text>
            </View>
          ))}
        </View>
      )}
      {mode === 'howMany' && forecast.howMany && (
        <View style={s.percRow}>
          {[
            { label: 'P50', val: String(forecast.howMany.conf50), color: Colors.success },
            { label: 'P85', val: String(forecast.howMany.conf85), color: Colors.warning },
            { label: 'P95', val: String(forecast.howMany.conf95), color: Colors.error },
          ].map(p => (
            <View key={p.label} style={s.perc}>
              <Text style={s.percLabel}>{p.label}</Text>
              <Text style={[s.percValue, { color: p.color }]}>{p.val}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Histogram */}
      {data.length > 0 && (
        <View style={s.chart}>
          <CartesianChart
            data={data}
            xKey="x"
            yKeys={['count']}
            domainPadding={{ left: 8, right: 8, top: 12 }}
          >
            {({ points, chartBounds }) => (
              <Bar
                points={points.count}
                chartBounds={chartBounds}
                color={Colors.primary}
                roundedCorners={{ topLeft: 2, topRight: 2 }}
              />
            )}
          </CartesianChart>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  toggle: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: 11, color: Colors.textMuted },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  percRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  perc: { flex: 1, backgroundColor: Colors.bg, borderRadius: 8, padding: 8, alignItems: 'center' },
  percLabel: { fontSize: 9, color: Colors.textSubtle, marginBottom: 4 },
  percValue: { fontSize: 18, fontWeight: '700' },
  chart: { height: 120 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 12, color: Colors.textSubtle },
});
```

- [ ] **Step 4: Write `mobile/app/(tabs)/analisis.tsx`**

```tsx
import { ScrollView, View, Text, StyleSheet, Dimensions } from 'react-native';
import { CartesianChart, Area, Scatter } from 'victory-native';
import { Colors, Card, Typography } from '../../lib/theme';
import { BottleneckRow } from '../../components/BottleneckRow';
import { ForecastCard } from '../../components/ForecastCard';
import { EmptyState } from '../../components/EmptyState';
import { useAnalysis } from '../../hooks/useAnalysis';

const W = Dimensions.get('window').width - 32;
const CFD_COLORS = ['#718096', '#9F7AEA', '#3182CE', '#3182CE', '#68D391'];

export default function AnalisisScreen() {
  const { bottleneck, forecast, cfd, issues, hasData } = useAnalysis();

  if (!hasData) return <EmptyState />;

  const scatterData = issues
    .filter(i => i.ct_days != null && i.last_transition_at)
    .map(i => ({
      ts: new Date(i.last_transition_at!).getTime(),
      days: i.ct_days!,
    }));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* Bottleneck */}
      {bottleneck && bottleneck.states.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cuellos de botella</Text>
          <View style={Card.base}>
            {bottleneck.states.map(st => (
              <BottleneckRow key={st.status} state={st} />
            ))}
          </View>
        </>
      )}

      {/* Forecast */}
      {forecast && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Forecast Monte Carlo</Text>
          <ForecastCard forecast={forecast} />
        </>
      )}

      {/* CFD */}
      {cfd.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cumulative Flow Diagram</Text>
          <View style={[Card.base, { height: 180 }]}>
            <CartesianChart
              data={cfd.map(p => ({ ...p, date: p.date.slice(5) }))}
              xKey="date"
              yKeys={['todo', 'in_progress', 'in_review', 'in_qa', 'done']}
            >
              {({ points }) => (
                <>
                  {(['todo', 'in_progress', 'in_review', 'in_qa', 'done'] as const).map((key, i) => (
                    <Area
                      key={key}
                      points={points[key]}
                      color={CFD_COLORS[i]}
                      opacity={0.75}
                    />
                  ))}
                </>
              )}
            </CartesianChart>
          </View>
        </>
      )}

      {/* Scatter cycle time */}
      {scatterData.length > 0 && (
        <>
          <Text style={[Typography.label, s.sectionLabel]}>Cycle Time</Text>
          <View style={[Card.base, { height: 180 }]}>
            <CartesianChart
              data={scatterData}
              xKey="ts"
              yKeys={['days']}
              domainPadding={{ top: 16 }}
            >
              {({ points }) => (
                <Scatter
                  points={points.days}
                  color={Colors.primary}
                  radius={4}
                />
              )}
            </CartesianChart>
          </View>
        </>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 16, gap: 12 },
  sectionLabel: { marginTop: 4 },
});
```

- [ ] **Step 5: Verify in simulator**

After sync, navigate to Análisis. Expected: bottleneck list with severity bars, forecast card with toggle (¿Cuándo? / ¿Cuántos?) + percentiles + histogram, CFD area chart, scatter plot.

- [ ] **Step 6: Commit**

```bash
git add mobile/hooks/useAnalysis.ts mobile/components/BottleneckRow.tsx mobile/components/ForecastCard.tsx mobile/app/(tabs)/analisis.tsx
git commit -m "feat(mobile): tab Análisis con bottleneck, forecast, CFD y scatter"
```

---

### Task 10: Logo SVG + Expo assets

**Files:**
- Create: `mobile/assets/logo-source.svg`
- Modify: `mobile/app.json`

- [ ] **Step 1: Create `mobile/assets/logo-source.svg`**

This is the Kanban Flow logo (3 ascending columns in blue shades). Save as `mobile/assets/logo-source.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
  <!-- Background -->
  <rect width="200" height="200" rx="40" fill="#1e293b"/>
  <!-- Column 1: Todo (gray, short) -->
  <rect x="28" y="108" width="40" height="64" rx="6" fill="#4A5568"/>
  <rect x="28" y="88"  width="40" height="16" rx="4" fill="#4A5568"/>
  <!-- Flow arrow 1→2 -->
  <path d="M70 140 L82 140" stroke="#3182CE" stroke-width="3" stroke-linecap="round"/>
  <path d="M79 136 L84 140 L79 144" stroke="#3182CE" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <!-- Column 2: In Progress (blue, medium) -->
  <rect x="84" y="68"  width="40" height="104" rx="6" fill="#3182CE"/>
  <!-- Flow arrow 2→3 -->
  <path d="M126 140 L138 140" stroke="#63B3ED" stroke-width="3" stroke-linecap="round"/>
  <path d="M135 136 L140 140 L135 144" stroke="#63B3ED" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <!-- Column 3: Done (blue light, tall) -->
  <rect x="140" y="28" width="40" height="144" rx="6" fill="#63B3ED"/>
  <!-- Checkmark on done column -->
  <path d="M152 110 L158 117 L172 100" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
```

- [ ] **Step 2: Generate PNG assets**

Install `sharp-cli` globally or use an online SVG→PNG converter to export:
- `mobile/assets/icon.png` — 1024×1024 from the SVG above
- `mobile/assets/adaptive-icon.png` — 1024×1024 same image (foreground for Android)
- `mobile/assets/splash-icon.png` — 512×512 centered on dark background `#0f172a`

Using `sharp-cli`:
```bash
npm install -g sharp-cli
sharp -i mobile/assets/logo-source.svg -o mobile/assets/icon.png resize 1024 1024
sharp -i mobile/assets/logo-source.svg -o mobile/assets/adaptive-icon.png resize 1024 1024
sharp -i mobile/assets/logo-source.svg -o mobile/assets/splash-icon.png resize 512 512
```

If `sharp-cli` is not available, use https://svgconvert.com or Figma to export the PNGs at the required sizes.

- [ ] **Step 3: Update `mobile/app.json`**

Replace the `expo` key with:

```json
{
  "expo": {
    "name": "TeamMetrics",
    "slug": "team-metrics-mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "dark",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#0f172a"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.teammetrics.mobile"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0f172a"
      },
      "package": "com.teammetrics.mobile"
    },
    "plugins": ["expo-router"],
    "scheme": "teammetrics",
    "web": { "bundler": "metro" }
  }
}
```

- [ ] **Step 4: Verify logo in simulator**

```bash
npx expo start --clear
```

The splash screen should show the logo on a dark background. The app icon (visible after installing) should show the Kanban Flow icon.

- [ ] **Step 5: Final test run**

```bash
cd mobile && npx jest
```

Expected: all tests pass (api, db, sync suites).

- [ ] **Step 6: Commit**

```bash
git add mobile/assets/ mobile/app.json
git commit -m "feat(mobile): logo Kanban Flow y assets de la app"
```

---

## Self-review checklist

**Spec coverage:**
- [x] iOS + Android → Expo cross-platform
- [x] SQLite local + sync manual → Tasks 3, 4
- [x] Endpoint configurable → Task 5 (Ajustes + AsyncStorage)
- [x] 5 tabs con contenido correcto → Tasks 6–9
- [x] EmptyState en primera apertura → Task 5 (EmptyState component)
- [x] Filtros globales persona + talla → filterStore + useIssues
- [x] Victory Native para gráficos → Tasks 6, 9
- [x] Logo Kanban Flow → Task 10
- [x] Feather icons → Task 1 (tabs _layout)
- [x] Sync error handling → sync.ts usa Promise.allSettled + SyncResult.errors

**Type consistency:**
- `KpiRow` in db.ts matches fields read in useKPIs.ts ✓
- `PersonScorecard` from types.ts stored as JSON in scorecard_members ✓
- `performSync()` returns `SyncResult` consumed by syncStore.ts ✓
- `dataVersion` in syncStore triggers re-read in all hooks ✓
