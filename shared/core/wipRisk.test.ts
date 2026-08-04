// shared/core/wipRisk.test.ts
// Ports server/src/services/wipRisk.test.ts onto in-memory arrays (no SQLite).
import { describe, it, expect, beforeEach } from 'vitest';
import { computeWipRisk } from './wipRisk';
import type { CoreIssueWithTitle, CoreTransition, Talla } from './types';

const NOW = new Date('2026-06-26T12:00:00Z');

let issues: CoreIssueWithTitle[];
let transitions: CoreTransition[];

// A completed issue: enters In Progress at `startAt`, reaches Done at `doneAt`.
function seedCompleted(id: string, talla: string, startAt: string, doneAt: string) {
  issues.push({
    id, title: `Done ${id}`, status: 'Done', assignee_id: null,
    talla: talla as Talla, created_at: '2026-01-01T00:00:00Z', last_transition_at: doneAt,
  });
  transitions.push({ issue_id: id, from_status: 'To Do', to_status: 'In Progress', transitioned_at: startAt });
  transitions.push({ issue_id: id, from_status: 'In Progress', to_status: 'Done', transitioned_at: doneAt });
}

// An in-progress issue: enters In Progress at `startAt`, optional extra transitions, not Done.
function seedActive(id: string, talla: string | null, status: string, startAt: string, extra: [string, string][] = []) {
  issues.push({
    id, title: `WIP ${id}`, status, assignee_id: 'u1',
    talla: talla as Talla | null, created_at: '2026-06-01T00:00:00Z', last_transition_at: startAt,
  });
  transitions.push({ issue_id: id, from_status: 'To Do', to_status: 'In Progress', transitioned_at: startAt });
  for (const [to, at] of extra) {
    transitions.push({ issue_id: id, from_status: 'In Progress', to_status: to, transitioned_at: at });
  }
}

// Seed 5 completed of `talla`, each with a cycle time of `cycleDays` days (within the window).
function seedFiveCompleted(talla: string, cycleDays: number, idPrefix: string) {
  for (let i = 0; i < 5; i++) {
    const start = `2026-06-1${i}T00:00:00Z`;
    const done = new Date(new Date(start).getTime() + cycleDays * 86400000).toISOString();
    seedCompleted(`${idPrefix}-${i}`, talla, start, done);
  }
}

describe('computeWipRisk', () => {
  beforeEach(() => {
    issues = [];
    transitions = [];
  });

  it('derives the p85 limit and sample_count per talla', () => {
    // 5 M completed, all 4-day cycle → p85 = 4
    seedFiveCompleted('M', 4, 'M');
    const r = computeWipRisk(issues, transitions, { now: NOW });
    const m = r.limits.find(l => l.talla === 'M')!;
    expect(m.sample_count).toBe(5);
    expect(m.limit_days).toBeCloseTo(4, 5);
    const s = r.limits.find(l => l.talla === 'S')!;
    expect(s.limit_days).toBeNull();        // no S data
    expect(s.sample_count).toBe(0);
  });

  it('nulls the limit and counts sin_limite when under MIN_SAMPLES', () => {
    seedCompleted('S-a', 'S', '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z'); // 1 only
    seedActive('WIP-S', 'S', 'In Progress', '2026-06-01T00:00:00Z');           // started, not done
    const r = computeWipRisk(issues, transitions, { now: NOW });
    expect(r.limits.find(l => l.talla === 'S')!.limit_days).toBeNull();
    expect(r.items.find(i => i.issue_id === 'WIP-S')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('classifies excedido / en_riesgo / hidden by ratio', () => {
    seedFiveCompleted('L', 10, 'L');                                        // limit_L = 10
    seedActive('WIP-over', 'L', 'In Progress', '2026-06-14T12:00:00Z');      // 12 days → ratio 1.2
    seedActive('WIP-risk', 'L', 'In Progress', '2026-06-18T12:00:00Z');      // 8 days  → ratio 0.8
    seedActive('WIP-ok', 'L', 'In Progress', '2026-06-21T12:00:00Z');        // 5 days  → ratio 0.5
    const r = computeWipRisk(issues, transitions, { now: NOW });
    const over = r.items.find(i => i.issue_id === 'WIP-over')!;
    const risk = r.items.find(i => i.issue_id === 'WIP-risk')!;
    expect(over.level).toBe('excedido');
    expect(risk.level).toBe('en_riesgo');
    expect(r.items.find(i => i.issue_id === 'WIP-ok')).toBeUndefined();
    expect(r.counts).toMatchObject({ en_riesgo: 1, excedido: 1 });
  });

  it('measures age from the first active entry even if currently blocked', () => {
    seedFiveCompleted('M', 2, 'M');                                         // limit_M = 2
    // Entered active 6 days ago, blocked 1 day ago, not done → age 6, ratio 3.0
    seedActive('WIP-b', 'M', 'Blocked', '2026-06-20T12:00:00Z', [['Blocked', '2026-06-25T12:00:00Z']]);
    const r = computeWipRisk(issues, transitions, { now: NOW });
    const it_ = r.items.find(i => i.issue_id === 'WIP-b')!;
    expect(it_.age_days).toBeCloseTo(6, 1);
    expect(it_.level).toBe('excedido');
  });

  it('counts issues without a talla as sin_limite', () => {
    seedFiveCompleted('M', 4, 'M');
    seedActive('WIP-notalla', null, 'In Progress', '2026-06-01T00:00:00Z');
    const r = computeWipRisk(issues, transitions, { now: NOW });
    expect(r.items.find(i => i.issue_id === 'WIP-notalla')).toBeUndefined();
    expect(r.counts.sin_limite).toBe(1);
  });

  it('sorts items by ratio descending', () => {
    seedFiveCompleted('L', 10, 'L');
    seedActive('WIP-a', 'L', 'In Progress', '2026-06-15T12:00:00Z'); // 11 days → 1.1
    seedActive('WIP-b', 'L', 'In Progress', '2026-06-10T12:00:00Z'); // 16 days → 1.6
    const r = computeWipRisk(issues, transitions, { now: NOW });
    expect(r.items.map(i => i.issue_id)).toEqual(['WIP-b', 'WIP-a']);
  });

  it('handles Jira -0300 timestamps without NaN', () => {
    seedFiveCompleted('M', 4, 'M');
    seedActive('WIP-tz', 'M', 'In Progress', '2026-06-20T12:00:00-0300'); // age ~6 days
    const r = computeWipRisk(issues, transitions, { now: NOW });
    const it_ = r.items.find(i => i.issue_id === 'WIP-tz')!;
    expect(Number.isNaN(it_.age_days)).toBe(false);
    expect(it_.age_days).toBeGreaterThan(0);
  });
});
