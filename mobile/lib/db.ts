import * as SQLite from 'expo-sqlite';
import type {
  KPIMetrics, ThroughputWeek, AgingIssue,
  WipRiskResult, BottleneckResult, ForecastResult,
  ComparisonResult, CFDPoint, Issue, TeamScorecardResponse, TallaMetric,
} from './types';
import type { CoreIssueWorkload, CoreTransition, CoreMember } from '@teammetrics/core/types';
import type { JiraIssueRaw } from '@teammetrics/core/jira';
import type { WorkloadResult } from '@teammetrics/core/workload';
// Mismo parser que usa el server para la columna `boards`: ver parseBoardsColumn.
import { parseBoardsColumn } from '@teammetrics/core/workload';

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
    CREATE TABLE IF NOT EXISTS scorecard_context_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, context_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS by_talla_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workload_snapshot (
      id INTEGER PRIMARY KEY DEFAULT 1, result_json TEXT, synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
      assignee_id TEXT, talla TEXT, talla_confidence REAL,
      created_at TEXT, updated_at TEXT, last_transition_at TEXT,
      talla_pushed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT,
      from_status TEXT, to_status TEXT, transitioned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY, display_name TEXT, email TEXT, avatar_url TEXT
    );
    CREATE TABLE IF NOT EXISTS board_sync (
      board_id INTEGER PRIMARY KEY, last_synced_at TEXT
    );
  `);

  const issueCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(issues)`);
  for (const [col, ddl] of [
    ['talla_pushed', `ALTER TABLE issues ADD COLUMN talla_pushed INTEGER NOT NULL DEFAULT 0`],
    ['requester',    `ALTER TABLE issues ADD COLUMN requester TEXT`],
    ['boards',       `ALTER TABLE issues ADD COLUMN boards TEXT`],
    ['priority',     `ALTER TABLE issues ADD COLUMN priority TEXT`],
  ] as const) {
    if (!issueCols.some(c => c.name === col)) await db.execAsync(ddl);
  }

  const boardCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(board_sync)`);
  if (!boardCols.some(c => c.name === 'name')) {
    await db.execAsync(`ALTER TABLE board_sync ADD COLUMN name TEXT`);
  }
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

export async function readScorecardContext(db: SQLite.SQLiteDatabase): Promise<TeamScorecardResponse['context'] | null> {
  const row = await db.getFirstAsync<{ context_json: string }>('SELECT context_json FROM scorecard_context_snapshot WHERE id = 1');
  return row ? JSON.parse(row.context_json) : null;
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

export async function readWorkload(db: SQLite.SQLiteDatabase): Promise<WorkloadResult | null> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM workload_snapshot WHERE id = 1');
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

export async function readComparison(db: SQLite.SQLiteDatabase, week?: string): Promise<ComparisonResult | null> {
  const row = week
    ? await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM comparison_snapshot WHERE week = ?', [week])
    : await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM comparison_snapshot ORDER BY week DESC LIMIT 1');
  return row ? JSON.parse(row.result_json) : null;
}

export async function readComparisonWeeks(db: SQLite.SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ week: string }>('SELECT week FROM comparison_snapshot ORDER BY week DESC');
  return rows.map(r => r.week);
}

export async function readCycleTimeByTalla(db: SQLite.SQLiteDatabase): Promise<Record<string, number | null>> {
  const row = await db.getFirstAsync<{ result_json: string }>('SELECT result_json FROM by_talla_snapshot WHERE id = 1');
  if (!row) return { S: null, M: null, L: null, XL: null };
  const metrics: TallaMetric[] = JSON.parse(row.result_json);
  const result: Record<string, number | null> = {};
  for (const m of metrics) result[m.talla] = m.ct_p50;
  return result;
}

export async function readTeamMemberNames(db: SQLite.SQLiteDatabase): Promise<{ id: string; name: string }[]> {
  const rows = await db.getAllAsync<{ member_id: string; member_json: string }>(
    "SELECT member_id, member_json FROM scorecard_members WHERE member_id != '__team__' ORDER BY member_id ASC"
  );
  return rows.map(r => {
    const parsed = JSON.parse(r.member_json);
    return { id: r.member_id, name: parsed.member?.display_name ?? r.member_id };
  });
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

export async function loadCoreIssues(db: SQLite.SQLiteDatabase): Promise<CoreIssueWorkload[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT id, title, status, assignee_id, talla, created_at, last_transition_at,
            requester, priority, boards FROM issues`
  );
  return rows.map(r => ({ ...r, boards: parseBoardsColumn(r.boards) }));
}

// Mismo crudo/query que loadCoreIssues (usado por directSync): nombre propio para el
// drill-down de solicitante, que lee la tabla `issues` directo — sin snapshot ni
// endpoint — así el detalle funciona offline.
export const readWorkloadIssues = loadCoreIssues;

export function loadCoreTransitions(db: SQLite.SQLiteDatabase): Promise<CoreTransition[]> {
  return db.getAllAsync<CoreTransition>(
    'SELECT issue_id, from_status, to_status, transitioned_at FROM transitions'
  );
}

export function loadCoreMembers(db: SQLite.SQLiteDatabase): Promise<CoreMember[]> {
  return db.getAllAsync<CoreMember>(
    'SELECT id, display_name, email, avatar_url FROM team_members ORDER BY display_name'
  );
}

// ── Raw Writers ──────────────────────────────────────────────────────────────

export async function upsertRawIssues(db: SQLite.SQLiteDatabase, issues: JiraIssueRaw[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const issue of issues) {
      if (issue.assignee) {
        await db.runAsync(
          `INSERT INTO team_members (id, display_name, email, avatar_url) VALUES (?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url`,
          [issue.assignee.id, issue.assignee.display_name, issue.assignee.email, issue.assignee.avatar_url]
        );
      }
      const lastTransition = issue.transitions.length
        ? issue.transitions.reduce((a, b) => (a.transitioned_at > b.transitioned_at ? a : b)).transitioned_at
        : null;
      const prev = await db.getFirstAsync<{ boards: string | null }>(
        `SELECT boards FROM issues WHERE id = ?`, [issue.id]);
      const merged = [...new Set([
        ...parseBoardsColumn(prev?.boards),
        ...(issue.boards ?? []),
      ])].filter(n => !isNaN(n)).sort((a, b) => a - b).join(',');
      // Note: talla/talla_confidence intentionally omitted — new issues default NULL and the
      // ON CONFLICT SET does not touch them (classification is a separate step).
      await db.runAsync(
        `INSERT INTO issues (id, title, description, status, assignee_id, created_at, updated_at,
                             last_transition_at, requester, boards, priority)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description, status=excluded.status,
           assignee_id=excluded.assignee_id, updated_at=excluded.updated_at,
           last_transition_at=excluded.last_transition_at,
           requester=excluded.requester, boards=excluded.boards, priority=excluded.priority`,
        [issue.id, issue.title, issue.description, issue.status, issue.assignee?.id ?? null,
         issue.created_at, issue.updated_at, lastTransition, issue.requester ?? null, merged, issue.priority ?? null]
      );
      for (const t of issue.transitions) {
        const exists = await db.getFirstAsync(
          `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`,
          [issue.id, t.to_status, t.transitioned_at]
        );
        if (!exists) {
          await db.runAsync(
            `INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`,
            [issue.id, t.from_status, t.to_status, t.transitioned_at]
          );
        }
      }
    }
  });
}

export async function readUnclassifiedIssues(db: SQLite.SQLiteDatabase): Promise<{ id: string; title: string; description: string }[]> {
  return db.getAllAsync<{ id: string; title: string; description: string }>(
    'SELECT id, title, description FROM issues WHERE talla IS NULL'
  );
}

export async function updateIssueTallas(
  db: SQLite.SQLiteDatabase,
  results: Map<string, { talla: string | null; confidence: number }>,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [id, r] of results) {
      if (r.talla) {
        await db.runAsync('UPDATE issues SET talla=?, talla_confidence=?, talla_pushed=0 WHERE id=?', [r.talla, r.confidence, id]);
      }
    }
  });
}

export async function readPendingTallaPush(
  db: SQLite.SQLiteDatabase,
): Promise<{ id: string; talla: string; confidence: number }[]> {
  return db.getAllAsync<{ id: string; talla: string; confidence: number }>(
    'SELECT id, talla, talla_confidence AS confidence FROM issues WHERE talla IS NOT NULL AND talla_pushed = 0',
  );
}

export async function markTallasPushed(db: SQLite.SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE issues SET talla_pushed = 1 WHERE id IN (${placeholders})`, ids);
}

export async function getBoardLastSync(db: SQLite.SQLiteDatabase, boardId: number): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ last_synced_at: string }>(
    'SELECT last_synced_at FROM board_sync WHERE board_id = ?', [boardId]
  );
  return row?.last_synced_at;
}

export async function setBoardLastSync(
  db: SQLite.SQLiteDatabase, boardId: number, iso: string, name?: string | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO board_sync (board_id, last_synced_at, name) VALUES (?,?,?)
     ON CONFLICT(board_id) DO UPDATE SET last_synced_at=excluded.last_synced_at,
     name=COALESCE(excluded.name, board_sync.name)`,
    [boardId, iso, name ?? null]
  );
}

// Boards conocidos por directSync para computeWorkload. board_id 0 es el sentinela de
// `performSync` (crudo del server, ver getRawSince) y no un board real.
export async function listBoardSync(db: SQLite.SQLiteDatabase): Promise<{ id: number; name: string | null }[]> {
  const rows = await db.getAllAsync<{ board_id: number; name: string | null }>(
    'SELECT board_id, name FROM board_sync WHERE board_id != 0'
  );
  return rows.map(r => ({ id: r.board_id, name: r.name }));
}

export interface RawIssue {
  id: string; title: string; description: string; status: string;
  assignee_id: string | null; talla: string | null; talla_confidence: number | null;
  created_at: string; updated_at: string; last_transition_at: string | null;
  // Columnas de carga de trabajo. El drill-down por solicitante lee la tabla `issues`
  // local (para andar offline), asi que si no viajan en el crudo del server quedan
  // NULL en backend mode y el detalle sale vacio con el server arriba.
  requester: string | null; boards: string | null; priority: string | null;
}
export interface RawTransition { issue_id: string; from_status: string; to_status: string; transitioned_at: string }
export interface RawMember { id: string; display_name: string; email: string | null; avatar_url: string | null }
// Los nombres de board tambien vienen del server: `board_sync.name` solo lo escribia
// directSync, y en backend mode el header del drill-down quedaba sin squad.
export interface RawBoard { board_id: number; name: string | null }
export interface RawBundle {
  issues: RawIssue[]; transitions: RawTransition[]; members: RawMember[];
  boards?: RawBoard[];
  serverSyncedAt: string | null;
}

export async function upsertServerRaw(db: SQLite.SQLiteDatabase, bundle: RawBundle): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const m of bundle.members) {
      await db.runAsync(
        `INSERT INTO team_members (id, display_name, email, avatar_url) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email, avatar_url=excluded.avatar_url`,
        [m.id, m.display_name, m.email, m.avatar_url],
      );
    }
    // Nombres de board del server. Solo el `name`: `last_synced_at` es el cursor de
    // direct mode y no se toca desde aca (el crudo del server lleva su propio
    // sentinela, board_sync[0]).
    for (const b of bundle.boards ?? []) {
      await db.runAsync(
        `INSERT INTO board_sync (board_id, name) VALUES (?,?)
         ON CONFLICT(board_id) DO UPDATE SET name=COALESCE(excluded.name, board_sync.name)`,
        [b.board_id, b.name ?? null],
      );
    }
    for (const i of bundle.issues) {
      const pushed = i.talla != null ? 1 : 0;
      await db.runAsync(
        `INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, last_transition_at, requester, boards, priority, talla_pushed)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description, status=excluded.status,
           assignee_id=excluded.assignee_id, updated_at=excluded.updated_at, last_transition_at=excluded.last_transition_at,
           requester=excluded.requester, boards=excluded.boards, priority=excluded.priority,
           talla=COALESCE(excluded.talla, issues.talla),
           talla_confidence=COALESCE(excluded.talla_confidence, issues.talla_confidence),
           talla_pushed=CASE WHEN excluded.talla IS NOT NULL THEN 1 ELSE issues.talla_pushed END`,
        [i.id, i.title, i.description, i.status, i.assignee_id, i.talla, i.talla_confidence,
         i.created_at, i.updated_at, i.last_transition_at,
         i.requester ?? null, i.boards ?? null, i.priority ?? null, pushed],
      );
    }
    for (const t of bundle.transitions) {
      const exists = await db.getFirstAsync(
        `SELECT id FROM transitions WHERE issue_id = ? AND to_status = ? AND transitioned_at = ?`,
        [t.issue_id, t.to_status, t.transitioned_at],
      );
      if (!exists) {
        await db.runAsync(
          `INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`,
          [t.issue_id, t.from_status, t.to_status, t.transitioned_at],
        );
      }
    }
  });
}

// El since efectivo para bajar de Jira: el más nuevo entre la última sync directa de este
// board y el sentinela board_sync[0] (crudo del server). Ambos son ISO UTC (toISOString) →
// comparación lexical válida.
export async function getRawSince(db: SQLite.SQLiteDatabase, boardId: number): Promise<string | undefined> {
  const board = await getBoardLastSync(db, boardId);
  const sentinel = await getBoardLastSync(db, 0);
  if (!board) return sentinel;
  if (!sentinel) return board;
  return board > sentinel ? board : sentinel;
}

// Resetea todos los cursores de sync (por-board + sentinela 0). El próximo sync baja TODO
// de Jira/server (sin `since`), backfilleando updates que el delta se hubiera saltado
// (p.ej. issues cambiados durante una caída del sync). Escape hatch ante gaps del delta.
// Es un UPDATE, no un DELETE: la fila tambien guarda el `name` del board (lo unico que
// le da su nombre al squad en la pantalla de carga) y borrarla lo perdia hasta el
// proximo sync. La epoch cae antes de cualquier issue, asi que equivale a "sin marca"
// para el filtro incremental sin tirar el nombre.
export const BOARD_SYNC_EPOCH = '1970-01-01T00:00:00.000Z';

export async function clearAllBoardSync(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(`UPDATE board_sync SET last_synced_at = ?`, [BOARD_SYNC_EPOCH]);
}
