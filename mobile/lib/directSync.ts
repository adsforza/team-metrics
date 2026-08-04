// Pure orchestration layer: turns raw core rows (issues/transitions/members) into the
// same SnapshotBundle shape `performSync` builds from server HTTP responses, by calling
// the shared/core compute functions directly in-process (no DB, no network).
// `now` is threaded through every date-dependent call so the result is fully deterministic
// under test.
import { computeKpis } from '@teammetrics/core/metrics';
import {
  computeThroughputWeekly, computeCFD, computeAgingWIP, computeCycleTimeByTalla,
} from '@teammetrics/core/metricsExtra';
import { computeScorecard } from '@teammetrics/core/scorecard';
import { computeComparison } from '@teammetrics/core/comparison';
import { computeWipRisk } from '@teammetrics/core/wipRisk';
import { computeForecast } from '@teammetrics/core/forecast';
import { computeBottleneck } from '@teammetrics/core/bottleneck';
import type {
  CoreIssueWithTitle, CoreTransition, CoreMember, CoreFilter,
} from '@teammetrics/core/types';
import type { SnapshotBundle } from './snapshots';
import type { Issue } from './types';
import { getLastNMondays } from './weeks';

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
  issues: CoreIssueWithTitle[],
  transitions: CoreTransition[],
  members: CoreMember[],
  filters: { from?: string; to?: string; assignee?: string | null },
  now: Date = new Date(),
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
    wipRisk: computeWipRisk(issues, transitions, { now }),
    bottleneck: computeBottleneck(issues, transitions, { now }),
    forecast: computeForecast(issues, transitions, { now }),
    cfd: computeCFD(issues, transitions, params, now),
    byTalla: computeCycleTimeByTalla(issues, transitions, params),
    issues: mapIssues(issues, transitions),
    comparisonWeeks: weeks,
    comparisons,
  };
}
