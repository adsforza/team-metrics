export type Talla = 'S' | 'M' | 'L' | 'XL';

export interface CoreIssue {
  id: string; status: string; assignee_id: string | null;
  talla: Talla | null; created_at: string; last_transition_at: string | null;
}
export interface CoreTransition {
  issue_id: string; from_status: string | null; to_status: string; transitioned_at: string;
}
export interface CoreMember { id: string; display_name: string; email: string; avatar_url: string | null; }
export interface CoreFilter { assignee?: string; talla?: string; status?: string; from?: string; to?: string; }

export interface FilterParams { assignee?: string; talla?: string; status?: string; from?: string; to?: string; }
export interface KPIMetrics {
  wip: number; throughput: number;
  cycle_time_p50: number | null; cycle_time_p85: number | null; blocked_count: number;
}

export type Trend = 'up' | 'down' | 'flat';
export type Improving = 'better' | 'worse' | 'steady';
export interface DimensionValue { value: number | null; previous: number | null; trend: Trend; improving: Improving; }
export interface DimensionContext { min: number; median: number; max: number; }
export interface ScorecardDimensions {
  delivery: DimensionValue; predictability: DimensionValue; focus: DimensionValue;
  flow: DimensionValue; regressions: DimensionValue; blocked: DimensionValue;
}
export interface PersonScorecard extends ScorecardDimensions {
  member: { id: string; display_name: string; email: string; avatar_url: string | null };
}
export interface TeamScorecardResponse {
  team: ScorecardDimensions;
  members: PersonScorecard[];
  context: {
    delivery: DimensionContext; predictability: DimensionContext; focus: DimensionContext;
    flow: DimensionContext; regressions: DimensionContext; blocked: DimensionContext;
  };
}

export interface TallaMetric {
  talla: Talla;
  ct_p50: number | null;
  count: number;
  team_ct_p50: number | null;
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

export interface ForecastConfidenceDate { days: number; date: string }
export interface ForecastBin { x: number; count: number }

export interface ForecastWhen {
  conf50: ForecastConfidenceDate;
  conf85: ForecastConfidenceDate;
  conf95: ForecastConfidenceDate;
  histogram: ForecastBin[];
}

export interface ForecastHowMany {
  conf50: number;  // items (>=)
  conf85: number;
  conf95: number;
  histogram: ForecastBin[];
}

export interface ForecastResult {
  items: number;            // item count used for the "when" forecast (echo; default = current WIP)
  horizonDays: number;      // horizon used for the "how many" forecast (echo; default 14)
  lookbackDays: number;     // 84
  trials: number;           // 10000
  totalThroughput: number;  // total completed in the lookback window
  insufficientData: boolean;
  when: ForecastWhen | null;
  howMany: ForecastHowMany | null;
}

export type WipRiskLevel = 'en_riesgo' | 'excedido';

export interface WipRiskItem {
  issue_id: string;
  title: string;
  talla: Talla;                 // non-null: items without talla are excluded
  status: string;               // current status
  assignee_id: string | null;
  age_days: number;             // now − first active entry
  limit_days: number;           // p85 of the issue's talla
  ratio: number;                // age_days / limit_days
  level: WipRiskLevel;
}

export interface TallaLimit {
  talla: Talla;
  limit_days: number | null;    // null when sample_count < MIN_SAMPLES
  sample_count: number;
}

export interface WipRiskResult {
  lookbackDays: number;         // 84
  limits: TallaLimit[];         // S, M, L, XL
  items: WipRiskItem[];         // only en_riesgo + excedido, sorted by ratio desc
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
  week: string;     // ISO date of Monday (YYYY-MM-DD)
  avg_days: number;
}

export interface BottleneckStateDetail {
  p85_days: number | null;
  pct_of_wip: number;        // state.queue_size / result.total_active
  trend_pct: number | null;  // % change from first to last trend point; null if <2 points
  trend: BottleneckWeekPoint[];
  top_issues: BottleneckTopIssue[];  // up to 8, sorted by days_in_state desc
  by_talla: BottleneckTallaBreakdown[];
}

export interface BottleneckState {
  status: string;
  queue_size: number;
  avg_days: number | null;  // avg dwell time from completed passes (last 8 weeks); null if <3 samples
  score: BottleneckScore;
  detail: BottleneckStateDetail;
}

export interface BottleneckResult {
  lookbackWeeks: number;   // 8
  total_active: number;
  states: BottleneckState[];  // sorted: severity desc, then queue_size desc
}

export interface ComparisonPeriod {
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;   // null when previous === 0
}

export interface ComparisonResult {
  week: string;       // YYYY-MM-DD, Monday of the selected week
  prevWeek: string;   // YYYY-MM-DD, Monday of the previous week
  throughput: ComparisonPeriod;
  wip: ComparisonPeriod;
}
