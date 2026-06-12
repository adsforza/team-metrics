export type Talla = 'S' | 'M' | 'L' | 'XL';
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

export interface FilterParams {
  from?: string;
  to?: string;
  assignee?: string;
  talla?: string;
  status?: string;
}

export interface KPIMetrics {
  wip: number;
  throughput: number;
  cycle_time_p50: number | null;
  cycle_time_p85: number | null;
  blocked_count: number;
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

export interface PersonMetrics {
  member: TeamMember;
  throughput: number;
  ct_p50: number | null;
  mix_tallas: Record<Talla, number>;
  blocked: number;
  score: Score;
  sparkline: number[];
}
