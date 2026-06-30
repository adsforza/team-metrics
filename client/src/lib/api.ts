import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore, ComparisonResult, ComparisonPeriod } from '../../../server/src/types';

export type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue, TeamScorecardResponse, PersonScorecard, ScorecardDimensions, DimensionValue, DimensionContext, Issue, TeamMember, ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel, BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore, ComparisonResult, ComparisonPeriod };

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
  metrics: (p: Record<string, string | undefined> = {}) => get<KPIMetrics>('/metrics', p),
  metricsByTalla: (p: Record<string, string | undefined> = {}) => get<TallaMetric[]>('/metrics/by-talla', p),
  metricsCFD: (p: Record<string, string | undefined> = {}) => get<CFDPoint[]>('/metrics/cfd', p),
  metricsThroughput: (p: Record<string, string | undefined> = {}) => get<ThroughputWeek[]>('/metrics/throughput', p),
  metricsAging: (p: Record<string, string | undefined> = {}) => get<AgingIssue[]>('/metrics/aging', p),
  forecast: (p: Record<string, string | undefined> = {}) => get<ForecastResult>('/metrics/forecast', p),
  wipRisk: () => get<WipRiskResult>('/metrics/wip-risk'),
  bottleneck: () => get<BottleneckResult>('/metrics/bottleneck'),
  comparison: (week?: string) => get<ComparisonResult>(`/metrics/comparison${week ? `?week=${encodeURIComponent(week)}` : ''}`),
  team: (p: Record<string, string | undefined> = {}) => get<TeamScorecardResponse>('/team', p),
  teamMembers: () => get<TeamMember[]>('/team/members'),
  issues: (p: Record<string, string | undefined> = {}) => get<Issue[]>('/issues', p),
  syncNow: () => fetch('/api/sync', { method: 'POST' }).then(r => r.json()),
  syncStatus: () => get<unknown>('/sync/status'),
};
