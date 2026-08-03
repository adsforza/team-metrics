export type {
  Talla, FilterParams, KPIMetrics, Trend, Improving, DimensionValue, DimensionContext,
  ScorecardDimensions, PersonScorecard, TeamScorecardResponse,
  ThroughputWeek, CFDPoint, AgingIssue, TallaMetric,
  ForecastResult, ForecastWhen, ForecastHowMany, ForecastBin, ForecastConfidenceDate,
  BottleneckResult, BottleneckState, BottleneckStateDetail, BottleneckTopIssue,
  BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore,
  WipRiskResult, WipRiskItem, TallaLimit, WipRiskLevel,
  ComparisonResult, ComparisonPeriod,
} from '../../shared/core/types';

import type { Talla } from '../../shared/core/types';

export type Score = 'A' | 'B' | 'C' | 'D';

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

export interface Transition {
  id: number;
  issue_id: string;
  from_status: string;
  to_status: string;
  transitioned_at: string;
}

export interface TeamMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface SyncLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  synced_count: number;
  classified_count: number;
  error: string | null;
}

