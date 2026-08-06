import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as SQLite from 'expo-sqlite';
import { getBaseUrl, JIRA_BASE_URL_KEY, pushTallas, fetchRaw } from './api';
import {
  getDb, readPendingTallaPush, markTallasPushed,
  upsertServerRaw, getBoardLastSync, setBoardLastSync,
} from './db';
import type {
  KPIMetrics, ThroughputWeek, TeamScorecardResponse, AgingIssue,
  WipRiskResult, BottleneckResult, ForecastResult, ComparisonResult,
  CFDPoint, Issue, TallaMetric,
} from './types';
import { writeSnapshots, type SnapshotBundle } from './snapshots';

import { getLastNMondays } from './weeks';
import type { ProgressFn } from './progress';

export const LAST_SYNCED_KEY = 'last_synced_at';

export interface SyncError { endpoint: string; message: string }
export interface SyncResult { success: boolean; errors: SyncError[]; syncedAt: string; okCount: number; failCount: number }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function pushPendingTallas(
  db: SQLite.SQLiteDatabase,
): Promise<{ pushed: number; error?: string }> {
  try {
    const pending = await readPendingTallaPush(db);
    if (pending.length === 0) return { pushed: 0 };
    await pushTallas(pending);
    await markTallasPushed(db, pending.map(p => p.id));
    return { pushed: pending.length };
  } catch (err) {
    return { pushed: 0, error: String(err) };
  }
}

export async function performSync(dateParams?: { from: string; to: string }, assignee?: string | null, onProgress?: ProgressFn): Promise<SyncResult> {
  const baseUrl = await getBaseUrl();
  const db = await getDb();
  const errors: SyncError[] = [];
  const syncedAt = new Date().toISOString();

  const parts: string[] = [];
  if (dateParams) { parts.push(`from=${dateParams.from}`, `to=${dateParams.to}`); }
  if (assignee) parts.push(`assignee=${encodeURIComponent(assignee)}`);
  const qs = parts.length ? '?' + parts.join('&') : '';

  const mondays = getLastNMondays(6);
  onProgress?.({ label: 'Bajando métricas…' });
  const [kpi, throughput, team, aging, wipRisk, bottleneck, forecast, cfd, issues, byTalla] =
    await Promise.allSettled([
      fetchJson<KPIMetrics>(`${baseUrl}/api/metrics${qs}`),
      fetchJson<ThroughputWeek[]>(`${baseUrl}/api/metrics/throughput${qs}`),
      fetchJson<TeamScorecardResponse>(`${baseUrl}/api/team${qs}`),
      fetchJson<AgingIssue[]>(`${baseUrl}/api/metrics/aging${qs}`),
      fetchJson<WipRiskResult>(`${baseUrl}/api/metrics/wip-risk${qs}`),
      fetchJson<BottleneckResult>(`${baseUrl}/api/metrics/bottleneck${qs}`),
      fetchJson<ForecastResult>(`${baseUrl}/api/metrics/forecast${qs}`),
      fetchJson<CFDPoint[]>(`${baseUrl}/api/metrics/cfd${qs}`),
      fetchJson<Issue[]>(`${baseUrl}/api/issues${qs}`),
      fetchJson<TallaMetric[]>(`${baseUrl}/api/metrics/by-talla${qs}`),
    ]);
  const comparisons = await Promise.allSettled(
    mondays.map(w => {
      const cqs = [...parts, `week=${w}`].join('&');
      return fetchJson<ComparisonResult>(`${baseUrl}/api/metrics/comparison?${cqs}`);
    })
  );

  if (kpi.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics', message: String(kpi.reason) });
  if (throughput.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/throughput', message: String(throughput.reason) });
  if (team.status !== 'fulfilled') errors.push({ endpoint: '/api/team', message: String(team.reason) });
  if (aging.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/aging', message: String(aging.reason) });
  if (wipRisk.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/wip-risk', message: String(wipRisk.reason) });
  if (bottleneck.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/bottleneck', message: String(bottleneck.reason) });
  if (forecast.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/forecast', message: String(forecast.reason) });
  if (cfd.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/cfd', message: String(cfd.reason) });
  if (issues.status !== 'fulfilled') errors.push({ endpoint: '/api/issues', message: String(issues.reason) });
  if (byTalla.status !== 'fulfilled') errors.push({ endpoint: '/api/metrics/by-talla', message: String(byTalla.reason) });
  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i];
    if (c.status !== 'fulfilled') {
      errors.push({ endpoint: `/api/metrics/comparison?week=${mondays[i]}`, message: String(c.reason) });
    }
  }

  const bundle: SnapshotBundle = {
    kpi: kpi.status === 'fulfilled' ? kpi.value : undefined,
    throughput: throughput.status === 'fulfilled' ? throughput.value : undefined,
    team: team.status === 'fulfilled' ? team.value : undefined,
    aging: aging.status === 'fulfilled' ? aging.value : undefined,
    wipRisk: wipRisk.status === 'fulfilled' ? wipRisk.value : undefined,
    bottleneck: bottleneck.status === 'fulfilled' ? bottleneck.value : undefined,
    forecast: forecast.status === 'fulfilled' ? forecast.value : undefined,
    cfd: cfd.status === 'fulfilled' ? cfd.value : undefined,
    issues: issues.status === 'fulfilled' ? issues.value : undefined,
    byTalla: byTalla.status === 'fulfilled' ? byTalla.value : undefined,
    comparisonWeeks: mondays,
    comparisons: comparisons.flatMap(c => c.status === 'fulfilled' ? [{ week: c.value.week, result: c.value }] : []),
  };
  await writeSnapshots(db, bundle, syncedAt);

  onProgress?.({ label: 'Enviando tallas…' });
  const push = await pushPendingTallas(db);
  if (push.error) errors.push({ endpoint: '/api/tallas', message: push.error });

  // SP-C: mantener el crudo caliente para el próximo direct mode (best-effort).
  onProgress?.({ label: 'Bajando novedades…' });
  try {
    const sentinel = await getBoardLastSync(db, 0);
    const raw = await fetchRaw(sentinel);
    await upsertServerRaw(db, raw);
    if (raw.serverSyncedAt) await setBoardLastSync(db, 0, raw.serverSyncedAt);
  } catch (err) {
    errors.push({ endpoint: '/api/raw', message: String(err) });
  }

  const allResults = [
    kpi, throughput, team, aging, wipRisk, bottleneck, forecast, cfd, issues, byTalla,
    ...comparisons,
  ];
  const okCount = allResults.filter(r => r.status === 'fulfilled').length;
  const failCount = allResults.length - okCount;

  if (okCount > 0) {
    await AsyncStorage.setItem(LAST_SYNCED_KEY, syncedAt);
  }

  try {
    const cfg = await fetchJson<{ jiraBaseUrl: string }>(`${baseUrl}/api/config`);
    if (cfg.jiraBaseUrl) {
      await AsyncStorage.setItem(JIRA_BASE_URL_KEY, cfg.jiraBaseUrl.replace(/\/+$/, ''));
    }
  } catch { /* non-fatal */ }

  return { success: errors.length === 0, errors, syncedAt, okCount, failCount };
}
