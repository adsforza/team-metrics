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
