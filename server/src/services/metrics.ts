import Database from 'better-sqlite3';
import type { FilterParams, KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue } from '../types';
import { computeKpis, computeCycleTimes } from '../../../shared/core/metrics';
import { computeThroughputWeekly, computeCFD, computeAgingWIP, computeCycleTimeByTalla as coreComputeCycleTimeByTalla } from '../../../shared/core/metricsExtra';
import type { CoreIssueWithTitle, CoreTransition } from '../../../shared/core/types';

function loadIssuesAndTransitions(db: Database.Database): { issues: CoreIssueWithTitle[]; transitions: CoreTransition[] } {
  const issues = db.prepare(`SELECT id, title, status, assignee_id, talla, created_at, last_transition_at FROM issues`).all() as CoreIssueWithTitle[];
  const transitions = db.prepare(`SELECT issue_id, from_status, to_status, transitioned_at FROM transitions`).all() as CoreTransition[];
  return { issues, transitions };
}

export function getCycleTimes(db: Database.Database, params: FilterParams): number[] {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  return computeCycleTimes(issues, transitions, params);
}

export function getKPIs(db: Database.Database, params: FilterParams): KPIMetrics {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  const agingThreshold = Math.max(1, parseInt(process.env.AGING_THRESHOLD_DAYS ?? '7', 10) || 7);
  return computeKpis(issues, transitions, params, agingThreshold);
}

export function getCycleTimeByTalla(db: Database.Database, params: FilterParams): TallaMetric[] {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  return coreComputeCycleTimeByTalla(issues, transitions, params);
}

export function getCFD(db: Database.Database, params: FilterParams): CFDPoint[] {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  return computeCFD(issues, transitions, params, new Date());
}

export function getThroughputWeekly(db: Database.Database, params: FilterParams): ThroughputWeek[] {
  const { issues, transitions } = loadIssuesAndTransitions(db);
  return computeThroughputWeekly(issues, transitions, params, new Date());
}

export function getAgingWIP(db: Database.Database, params: FilterParams): AgingIssue[] {
  const { issues } = loadIssuesAndTransitions(db);
  return computeAgingWIP(issues, params, new Date());
}

