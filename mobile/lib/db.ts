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
