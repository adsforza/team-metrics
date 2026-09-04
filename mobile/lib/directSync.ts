// Pure orchestration layer: turns raw core rows (issues/transitions/members) into the
// same SnapshotBundle shape `performSync` builds from server HTTP responses, by calling
// the shared/core compute functions directly in-process (no DB, no network).
// `now` is threaded through every date-dependent call so the result is fully deterministic
// under test.
import type * as SQLite from 'expo-sqlite';
import { computeKpis } from '@teammetrics/core/metrics';
import {
  computeThroughputWeekly, computeCFD, computeAgingWIP, computeCycleTimeByTalla,
} from '@teammetrics/core/metricsExtra';
import { computeScorecard } from '@teammetrics/core/scorecard';
import { computeComparison } from '@teammetrics/core/comparison';
import { computeWipRisk } from '@teammetrics/core/wipRisk';
import { computeForecast } from '@teammetrics/core/forecast';
import { computeBottleneck } from '@teammetrics/core/bottleneck';
import { computeWorkload } from '@teammetrics/core/workload';
import { fetchBoardIssues } from '@teammetrics/core/jira';
import type { JiraConfig, JiraHttp } from '@teammetrics/core/jira';
import { classifyTallaBatch } from '@teammetrics/core/classify';
import type { GenerateFn } from '@teammetrics/core/classify';
import type {
  CoreIssueWithTitle, CoreIssueWorkload, CoreTransition, CoreMember, CoreFilter,
} from '@teammetrics/core/types';
import type { SnapshotBundle } from './snapshots';
import { writeSnapshots } from './snapshots';
import type { Issue } from './types';
import { getLastNMondays } from './weeks';
import type { ProgressFn } from './progress';
import {
  upsertRawIssues, getRawSince, setBoardLastSync,
  readUnclassifiedIssues, updateIssueTallas,
  loadCoreIssues, loadCoreTransitions, loadCoreMembers, listBoardSync,
} from './db';
import { jiraHttpFetch, makeGeminiGenerate } from './transports';

const MS_DAY = 1000 * 60 * 60 * 24;

// Mirrors server/src/routes/issues.ts exactly (the t_start/t_end sub-selects): start_at is
// the earliest transition into an "in progress"-like status, end_at the latest transition
// into a "done" status; ct_days is only populated for issues whose *current* status is done.
const CT_START_STATUSES = ['In Progress', 'IN PROGRESS', 'EN CURSO', 'In development'];
const CT_DONE_STATUSES = ['Done', 'Finalizada'];

function mapIssues(issues: CoreIssueWithTitle[], transitions: CoreTransition[]): Issue[] {
  const startByIssue = new Map<string, string>();
  const endByIssue = new Map<string, string>();
  for (const t of transitions) {
    if (CT_START_STATUSES.includes(t.to_status)) {
      const cur = startByIssue.get(t.issue_id);
      if (cur === undefined || t.transitioned_at < cur) startByIssue.set(t.issue_id, t.transitioned_at);
    }
    if (CT_DONE_STATUSES.includes(t.to_status)) {
      const cur = endByIssue.get(t.issue_id);
      if (cur === undefined || t.transitioned_at > cur) endByIssue.set(t.issue_id, t.transitioned_at);
    }
  }

  return issues.map(i => {
    const startAt = startByIssue.get(i.id);
    const endAt = endByIssue.get(i.id);
    const ct_days = CT_DONE_STATUSES.includes(i.status) && startAt && endAt
      ? (new Date(endAt).getTime() - new Date(startAt).getTime()) / MS_DAY
      : null;
    return {
      id: i.id,
      title: i.title,
      description: '',
      status: i.status,
      assignee_id: i.assignee_id,
      talla: i.talla,
      talla_confidence: null,
      created_at: i.created_at,
      updated_at: i.created_at,
      synced_at: i.created_at,
      last_transition_at: i.last_transition_at,
      ct_days,
    };
  });
}

export function computeBundle(
  issues: CoreIssueWorkload[],
  transitions: CoreTransition[],
  members: CoreMember[],
  filters: { from?: string; to?: string; assignee?: string | null },
  now: Date = new Date(),
  boards: { id: number; name: string }[] = [],
): SnapshotBundle {
  const params: CoreFilter = { from: filters.from, to: filters.to, assignee: filters.assignee ?? undefined };

  const weeks = getLastNMondays(6, now);
  const comparisons = weeks.map(w => ({
    week: w,
    result: computeComparison(issues, transitions, { week: w, now, assignee: filters.assignee }),
  }));

  return {
    kpi: computeKpis(issues, transitions, params, 7, now),
    throughput: computeThroughputWeekly(issues, transitions, params, now),
    team: computeScorecard(issues, transitions, members, params, now),
    aging: computeAgingWIP(issues, params, now),
    wipRisk: computeWipRisk(issues, transitions, { now, assignee: filters.assignee }),
    bottleneck: computeBottleneck(issues, transitions, { now, assignee: filters.assignee }),
    forecast: computeForecast(issues, transitions, { now, assignee: filters.assignee }),
    cfd: computeCFD(issues, transitions, params, now),
    byTalla: computeCycleTimeByTalla(issues, transitions, params),
    issues: mapIssues(issues, transitions),
    comparisonWeeks: weeks,
    comparisons,
    workload: computeWorkload(issues, boards, params),
  };
}

// ── directSync: full mobile-native sync orchestrator ────────────────────────
// Talks to Jira + Gemini directly (no server in the loop), persists raw issues/
// transitions into SQLite, classifies newly-seen issues, recomputes every metric
// via computeBundle above, and writes the resulting snapshot tables — the same
// tables `performSync` (server-backed sync) writes, so the read side is unaware
// of which sync path populated them.

const CLASSIFY_BATCH_SIZE = 20;

export interface DirectSyncError { endpoint: string; message: string }

export interface DirectSyncResult {
  success: boolean;
  errors: DirectSyncError[];
  syncedAt: string;
  okCount: number;
  failCount: number;
}

export interface DirectSyncConfig {
  boards: JiraConfig[];
  geminiKey: string;
  filters: { from?: string; to?: string; assignee?: string | null };
}

export interface DirectSyncDeps {
  http?: JiraHttp;
  makeGen?: (key: string) => GenerateFn;
  now?: Date;
  onProgress?: ProgressFn;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// En mobile clasificamos con retries=0: un 429 sin retryDelay hace que
// classifyTallaBatch espere backoff exponencial (2→4→…→64 min por lote), lo que
// cuelga el sync entero. Preferimos fallar rápido y reintentar en el próximo sync.
const CLASSIFY_RETRIES = 0;

// Clasifica todos los issues sin talla en lotes. Best-effort. Si un lote no clasifica
// NADA (todos confidence 0 = fallback por cuota/error), asumimos cuota agotada y CORTAMOS
// el resto: seguir sólo quemaría tiempo/tokens. Lo pendiente se reintenta el próximo sync.
async function classifyAllPending(
  db: SQLite.SQLiteDatabase,
  geminiKey: string,
  makeGen: (key: string) => GenerateFn,
  onProgress?: ProgressFn,
): Promise<{ okCount: number; failCount: number; classified: number; errors: DirectSyncError[] }> {
  const errors: DirectSyncError[] = [];
  let okCount = 0;
  let failCount = 0;
  let classified = 0;
  try {
    const pending = await readUnclassifiedIssues(db);
    const batches = chunk(pending, CLASSIFY_BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
      onProgress?.({ label: `Clasificando lote ${i + 1}/${batches.length}`, current: i + 1, total: batches.length });
      try {
        const results = await classifyTallaBatch(batches[i], makeGen(geminiKey), CLASSIFY_RETRIES);
        await updateIssueTallas(db, results);
        const values = [...results.values()];
        for (const r of values) if (r.talla != null) classified += 1;
        okCount += 1;
        // Lote entero sin señal (confidence 0 en todos) = fallback por cuota/error → cortar.
        if (values.length > 0 && values.every(r => r.confidence === 0)) {
          errors.push({ endpoint: `classify:batch:${i}`, message: 'sin clasificaciones (¿cuota Gemini agotada?) — corto el resto' });
          break;
        }
      } catch (err) {
        failCount += 1;
        errors.push({ endpoint: `classify:batch:${i}`, message: errMessage(err) });
        break; // error duro → cortar; se reintenta el próximo sync
      }
    }
  } catch (err) {
    failCount += 1;
    errors.push({ endpoint: 'classify:read-pending', message: errMessage(err) });
  }
  return { okCount, failCount, classified, errors };
}

// Recalcula todos los snapshots desde los datos crudos locales y los persiste.
async function recomputeSnapshots(
  db: SQLite.SQLiteDatabase,
  filters: DirectSyncConfig['filters'],
  now: Date,
  syncedAt: string,
): Promise<void> {
  const issues = await loadCoreIssues(db);
  const transitions = await loadCoreTransitions(db);
  const members = await loadCoreMembers(db);
  const boardRows = await listBoardSync(db);
  const boards = boardRows.map(b => ({ id: b.id, name: `Board ${b.id}` }));
  const bundle = computeBundle(issues, transitions, members, filters, now, boards);
  await writeSnapshots(db, bundle, syncedAt);
}

export async function directSync(
  db: SQLite.SQLiteDatabase,
  config: DirectSyncConfig,
  deps: DirectSyncDeps = {},
): Promise<DirectSyncResult> {
  const http = deps.http ?? jiraHttpFetch;
  const makeGen = deps.makeGen ?? makeGeminiGenerate;
  const now = deps.now ?? new Date();
  const syncedAt = now.toISOString();
  const onProgress = deps.onProgress;

  const errors: DirectSyncError[] = [];
  let okCount = 0;
  let failCount = 0;

  for (let bi = 0; bi < config.boards.length; bi++) {
    const boardCfg = config.boards[bi];
    onProgress?.({ label: `Bajando board ${bi + 1}/${config.boards.length}`, current: bi + 1, total: config.boards.length });
    try {
      const since = await getRawSince(db, boardCfg.boardId);
      const raw = await fetchBoardIssues(boardCfg, http, since);
      await upsertRawIssues(db, raw);
      await setBoardLastSync(db, boardCfg.boardId, syncedAt);
      okCount += 1;
    } catch (err) {
      failCount += 1;
      errors.push({ endpoint: `jira:board:${boardCfg.boardId}`, message: errMessage(err) });
    }
  }

  const cls = await classifyAllPending(db, config.geminiKey, makeGen, onProgress);
  okCount += cls.okCount;
  failCount += cls.failCount;
  errors.push(...cls.errors);

  onProgress?.({ label: 'Calculando…' });
  await recomputeSnapshots(db, config.filters, now, syncedAt);

  return { success: errors.length === 0, errors, syncedAt, okCount, failCount };
}

// ── directReclassify: reclasifica sin bajar de Jira ─────────────────────────
// Igual que la fase de clasificación de directSync (lee pendientes → Gemini →
// recompute snapshots), pero sin el fetch. Para el botón "Reclasificar" cuando
// no hay backend: rellena tallas al resetearse la cuota de Gemini.

export interface DirectReclassifyResult {
  classified: number;
  okCount: number;
  failCount: number;
  errors: DirectSyncError[];
  syncedAt: string;
}

export async function directReclassify(
  db: SQLite.SQLiteDatabase,
  config: DirectSyncConfig,
  deps: DirectSyncDeps = {},
): Promise<DirectReclassifyResult> {
  const makeGen = deps.makeGen ?? makeGeminiGenerate;
  const now = deps.now ?? new Date();
  const syncedAt = now.toISOString();
  const onProgress = deps.onProgress;

  const cls = await classifyAllPending(db, config.geminiKey, makeGen, onProgress);
  onProgress?.({ label: 'Calculando…' });
  await recomputeSnapshots(db, config.filters, now, syncedAt);

  return {
    classified: cls.classified,
    okCount: cls.okCount,
    failCount: cls.failCount,
    errors: cls.errors,
    syncedAt,
  };
}
