export type Talla = 'S' | 'M' | 'L' | 'XL';

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

export interface TeamMember {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

export interface KPIMetrics {
  wip: number;
  throughput: number;
  cycle_time_p50: number | null;
  cycle_time_p85: number | null;
  blocked_count: number;
}

export interface CFDPoint {
  date: string;
  todo: number;
  in_progress: number;
  in_review: number;
  in_qa: number;
  done: number;
}

export interface ThroughputWeek {
  week: string;
  count: number;
  by_talla: Record<Talla, number>;
}

export interface AgingIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  status: string;
  days_in_status: number;
  assignee_id: string | null;
}

export type Trend = 'up' | 'down' | 'flat';
export type Improving = 'better' | 'worse' | 'steady';

export interface DimensionValue {
  value: number | null;
  previous: number | null;
  trend: Trend;
  improving: Improving;
}

export interface DimensionContext {
  min: number;
  median: number;
  max: number;
}

export interface ScorecardDimensions {
  delivery: DimensionValue;
  predictability: DimensionValue;
  focus: DimensionValue;
  flow: DimensionValue;
}

export interface PersonScorecard extends ScorecardDimensions {
  member: TeamMember;
}

export interface TeamScorecardResponse {
  team: ScorecardDimensions;
  members: PersonScorecard[];
  context: {
    delivery: DimensionContext;
    predictability: DimensionContext;
    focus: DimensionContext;
    flow: DimensionContext;
  };
}

export interface ForecastConfidenceDate { days: number; date: string }
export interface ForecastBin { x: number; count: number }

export interface ForecastWhen {
  conf50: ForecastConfidenceDate;
  conf85: ForecastConfidenceDate;
  conf95: ForecastConfidenceDate;
  histogram: ForecastBin[];
}

export interface ForecastHowMany {
  conf50: number;
  conf85: number;
  conf95: number;
  histogram: ForecastBin[];
}

export interface ForecastResult {
  items: number;
  horizonDays: number;
  lookbackDays: number;
  trials: number;
  totalThroughput: number;
  insufficientData: boolean;
  when: ForecastWhen | null;
  howMany: ForecastHowMany | null;
}

export type WipRiskLevel = 'en_riesgo' | 'excedido';

export interface WipRiskItem {
  issue_id: string;
  title: string;
  talla: Talla;
  status: string;
  assignee_id: string | null;
  age_days: number;
  limit_days: number;
  ratio: number;
  level: WipRiskLevel;
}

export interface TallaLimit {
  talla: Talla;
  limit_days: number | null;
  sample_count: number;
}

export interface WipRiskResult {
  lookbackDays: number;
  limits: TallaLimit[];
  items: WipRiskItem[];
  counts: { en_riesgo: number; excedido: number; sin_limite: number };
}

export type BottleneckScore = 'crítico' | 'alto' | 'medio' | 'normal';

export interface BottleneckTopIssue {
  issue_id: string;
  title: string;
  talla: Talla | null;
  days_in_state: number;
}

export interface BottleneckTallaBreakdown {
  talla: Talla;
  avg_days: number;
  count: number;
}

export interface BottleneckWeekPoint {
  week: string;
  avg_days: number;
}

export interface BottleneckStateDetail {
  p85_days: number | null;
  pct_of_wip: number;
  trend_pct: number | null;
  trend: BottleneckWeekPoint[];
  top_issues: BottleneckTopIssue[];
  by_talla: BottleneckTallaBreakdown[];
}

export interface BottleneckState {
  status: string;
  queue_size: number;
  avg_days: number | null;
  score: BottleneckScore;
  detail: BottleneckStateDetail;
}

export interface BottleneckResult {
  lookbackWeeks: number;
  total_active: number;
  states: BottleneckState[];
}

export interface ComparisonPeriod {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

export interface ComparisonResult {
  week: string;
  prevWeek: string;
  throughput: ComparisonPeriod;
  wip: ComparisonPeriod;
}
