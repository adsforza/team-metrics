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
