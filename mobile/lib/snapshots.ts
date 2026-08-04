import * as SQLite from 'expo-sqlite';
import type {
  KPIMetrics, ThroughputWeek, TeamScorecardResponse, AgingIssue,
  WipRiskResult, BottleneckResult, ForecastResult, ComparisonResult,
  CFDPoint, TallaMetric,
} from '@teammetrics/core/types';
import type { Issue } from './types';

export interface SnapshotBundle {
  kpi?: KPIMetrics;
  throughput?: ThroughputWeek[];
  team?: TeamScorecardResponse;
  aging?: AgingIssue[];
  wipRisk?: WipRiskResult;
  bottleneck?: BottleneckResult;
  forecast?: ForecastResult;
  cfd?: CFDPoint[];
  issues?: Issue[];
  byTalla?: TallaMetric[];
  comparisonWeeks?: string[];
  comparisons?: { week: string; result: ComparisonResult }[];
}

export async function writeSnapshots(db: SQLite.SQLiteDatabase, bundle: SnapshotBundle, syncedAt: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (bundle.kpi !== undefined) {
      const k = bundle.kpi;
      await db.runAsync(
        'INSERT OR REPLACE INTO kpi_snapshot (id, wip, throughput, cycle_time_p50, cycle_time_p85, blocked_count, synced_at) VALUES (1,?,?,?,?,?,?)',
        [k.wip, k.throughput, k.cycle_time_p50, k.cycle_time_p85, k.blocked_count, syncedAt]
      );
    }

    if (bundle.throughput !== undefined) {
      await db.runAsync('DELETE FROM throughput_weekly');
      for (const w of bundle.throughput) {
        await db.runAsync(
          'INSERT INTO throughput_weekly (week, count, by_talla) VALUES (?,?,?)',
          [w.week, w.count, JSON.stringify(w.by_talla)]
        );
      }
    }

    if (bundle.team !== undefined) {
      await db.runAsync('DELETE FROM scorecard_members');
      const t = bundle.team;
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
      await db.runAsync(
        'INSERT OR REPLACE INTO scorecard_context_snapshot (id, context_json, synced_at) VALUES (1,?,?)',
        [JSON.stringify(t.context), syncedAt]
      );
    }

    if (bundle.aging !== undefined) {
      await db.runAsync('DELETE FROM aging_issues');
      for (const a of bundle.aging) {
        await db.runAsync(
          'INSERT INTO aging_issues (issue_id, title, talla, status, days_in_status, assignee_id) VALUES (?,?,?,?,?,?)',
          [a.issue_id, a.title, a.talla, a.status, a.days_in_status, a.assignee_id]
        );
      }
    }

    for (const [value, table] of [
      [bundle.wipRisk, 'wip_risk_snapshot'],
      [bundle.bottleneck, 'bottleneck_snapshot'],
      [bundle.forecast, 'forecast_snapshot'],
    ] as const) {
      if (value !== undefined) {
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (id, result_json, synced_at) VALUES (1,?,?)`,
          [JSON.stringify(value), syncedAt]
        );
      }
    }

    // Prune weeks outside the current window so stale/misaligned keys (e.g. a
    // non-Monday date from an old timezone bug) don't linger in the selector.
    if (bundle.comparisonWeeks !== undefined) {
      await db.runAsync(
        `DELETE FROM comparison_snapshot WHERE week NOT IN (${bundle.comparisonWeeks.map(() => '?').join(',')})`,
        bundle.comparisonWeeks
      );
    }
    if (bundle.comparisons !== undefined) {
      for (const c of bundle.comparisons) {
        await db.runAsync(
          'INSERT OR REPLACE INTO comparison_snapshot (week, result_json, synced_at) VALUES (?,?,?)',
          [c.week, JSON.stringify(c.result), syncedAt]
        );
      }
    }

    if (bundle.cfd !== undefined) {
      await db.runAsync('DELETE FROM cfd_points');
      for (const p of bundle.cfd) {
        await db.runAsync(
          'INSERT INTO cfd_points (date, todo, in_progress, in_review, in_qa, done) VALUES (?,?,?,?,?,?)',
          [p.date, p.todo, p.in_progress, p.in_review, p.in_qa, p.done]
        );
      }
    }

    if (bundle.issues !== undefined) {
      await db.runAsync('DELETE FROM issues_snapshot');
      for (const i of bundle.issues) {
        await db.runAsync(
          'INSERT INTO issues_snapshot (issue_id, title, status, talla, assignee_id, ct_days, last_transition_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
          [i.id, i.title, i.status, i.talla, i.assignee_id, i.ct_days, i.last_transition_at, i.created_at]
        );
      }
    }

    if (bundle.byTalla !== undefined) {
      await db.runAsync(
        'INSERT OR REPLACE INTO by_talla_snapshot (id, result_json, synced_at) VALUES (1,?,?)',
        [JSON.stringify(bundle.byTalla), syncedAt]
      );
    }
  });
}
