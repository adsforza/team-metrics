// Pure, in-memory port of server/src/services/forecast.test.ts (Monte Carlo forecast).
// Note: the source test file has no seeded/fixed rng — its Monte Carlo assertions are
// robust by construction (degenerate daily arrays, or percentile monotonicity that holds
// for any sample ordering), so tests here follow the same approach with `Math.random`.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  dailyThroughput, simulateWhen, simulateHowMany, histogram, computeForecast,
} from './forecast';
import type { CoreIssue, CoreTransition } from './types';

function doneTransition(id: string, doneAt: string): CoreTransition {
  return { issue_id: id, from_status: 'In Progress', to_status: 'Done', transitioned_at: doneAt };
}

function doneIssue(id: string, doneAt: string): CoreIssue {
  return {
    id, status: 'Done', assignee_id: null, talla: 'M',
    created_at: '2026-01-01T00:00:00Z', last_transition_at: doneAt,
  };
}

function activeIssue(id: string): CoreIssue {
  return {
    id, status: 'In Progress', assignee_id: null, talla: 'M',
    created_at: '2026-06-01T00:00:00Z', last_transition_at: '2026-06-20T00:00:00Z',
  };
}

describe('dailyThroughput', () => {
  it('buckets completions into the correct day within the lookback window', () => {
    const now = new Date('2026-06-25T12:00:00Z');
    const transitions = [
      doneTransition('A-1', '2026-06-24T10:00:00Z'),
      doneTransition('A-2', '2026-06-24T20:00:00-0300'),
      doneTransition('A-3', '2026-06-25T09:00:00Z'),
    ];
    const daily = dailyThroughput(transitions, 84, now);
    expect(daily).toHaveLength(84);
    expect(daily[83]).toBe(1); // today (2026-06-25)
    expect(daily[82]).toBe(2); // yesterday (2026-06-24)
    expect(daily.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('ignores completions outside the window', () => {
    const now = new Date('2026-06-25T12:00:00Z');
    const transitions = [doneTransition('OLD', '2026-01-01T10:00:00Z')];
    const daily = dailyThroughput(transitions, 84, now);
    expect(daily.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('simulateHowMany', () => {
  it('with a constant 1/day history, completes exactly `horizon` items', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateHowMany(daily, 10, 2000, Math.random);
    expect(samples).toHaveLength(2000);
    expect(samples.every(s => s === 10)).toBe(true);
  });
});

describe('simulateWhen', () => {
  it('with a constant 1/day history, needs exactly `items` days', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateWhen(daily, 7, 2000, Math.random);
    expect(samples.every(s => s === 7)).toBe(true);
  });

  it('returns a sorted ascending array', () => {
    const daily = [0, 1, 2, 0, 3, 1];
    const samples = simulateWhen(daily, 5, 1000, Math.random);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });

  it('caps the day count at maxDays when items can never be reached', () => {
    const daily = [0]; // no throughput ever → never reaches items
    const samples = simulateWhen(daily, 5, 500, Math.random, 730);
    expect(samples.every(s => s === 730)).toBe(true);
  });
});

describe('histogram', () => {
  it('returns a single bin when the range is degenerate', () => {
    const bins = histogram(new Array(100).fill(5));
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ x: 5, count: 100 });
  });

  it('partitions samples into ~20 bins covering the central 90%', () => {
    const sorted = Array.from({ length: 1000 }, (_, i) => i).sort((a, b) => a - b);
    const bins = histogram(sorted);
    expect(bins.length).toBe(20);
    const total = bins.reduce((a, b) => a + b.count, 0);
    expect(total).toBeGreaterThan(850);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('uses one bin per integer when range is small (avoids duplicate x labels)', () => {
    // Simulate a "when" result with days 1–4 (as Monte Carlo would produce)
    const samples = [
      ...Array(600).fill(1),
      ...Array(250).fill(2),
      ...Array(100).fill(3),
      ...Array(50).fill(4),
    ];
    const bins = histogram(samples);
    const xs = bins.map(b => b.x);
    expect(new Set(xs).size).toBe(xs.length); // no duplicate x labels
    expect(bins.find(b => b.x === 1)!.count).toBeGreaterThan(0);
    expect(bins.find(b => b.x === 2)!.count).toBeGreaterThan(0);
  });
});

describe('computeForecast', () => {
  const now = new Date('2026-06-25T12:00:00Z');
  let issues: CoreIssue[];
  let transitions: CoreTransition[];

  beforeEach(() => {
    issues = [];
    transitions = [];
  });

  it('flags insufficient data when nothing completed in the window', () => {
    issues.push(activeIssue('W-1'));
    const f = computeForecast(issues, transitions, { now });
    expect(f.insufficientData).toBe(true);
    expect(f.when).toBeNull();
    expect(f.howMany).toBeNull();
  });

  it('defaults `items` to the current WIP count', () => {
    issues.push(activeIssue('W-1'), activeIssue('W-2'), doneIssue('D-1', '2026-06-24T10:00:00Z'));
    transitions.push(doneTransition('D-1', '2026-06-24T10:00:00Z'));
    const f = computeForecast(issues, transitions, { now });
    expect(f.items).toBe(2);
    expect(f.insufficientData).toBe(false);
  });

  it('wires confidence levels to the correct tails', () => {
    for (let d = 0; d < 30; d++) {
      const id = `X-${d}`;
      const doneAt = `2026-06-${String((d % 25) + 1).padStart(2, '0')}T10:00:00Z`;
      issues.push(doneIssue(id, doneAt));
      transitions.push(doneTransition(id, doneAt));
    }
    const f = computeForecast(issues, transitions, { items: 20, horizon: 14, now });
    expect(f.when!.conf95.days).toBeGreaterThanOrEqual(f.when!.conf85.days);
    expect(f.when!.conf85.days).toBeGreaterThanOrEqual(f.when!.conf50.days);
    expect(f.howMany!.conf95).toBeLessThanOrEqual(f.howMany!.conf85);
    expect(f.howMany!.conf85).toBeLessThanOrEqual(f.howMany!.conf50);
    expect(f.when!.conf50.date).toBe(new Date(now.getTime() + f.when!.conf50.days * 24 * 3600 * 1000).toISOString().slice(0, 10));
  });

  it('defaults items to 1 when there is no WIP', () => {
    issues.push(doneIssue('D-1', '2026-06-24T10:00:00Z')); // throughput exists, but no active issues
    transitions.push(doneTransition('D-1', '2026-06-24T10:00:00Z'));
    const f = computeForecast(issues, transitions, { now });
    expect(f.items).toBe(1);
  });

  it('clamps out-of-range inputs and echoes the values used', () => {
    issues.push(doneIssue('D-1', '2026-06-24T10:00:00Z'));
    transitions.push(doneTransition('D-1', '2026-06-24T10:00:00Z'));
    expect(computeForecast(issues, transitions, { items: 99999, now }).items).toBe(1000);
    expect(computeForecast(issues, transitions, { horizon: 9999, now }).horizonDays).toBe(365);
    expect(computeForecast(issues, transitions, { horizon: 0, now }).horizonDays).toBe(14);
  });
});

describe('computeForecast — filtro por assignee', () => {
  it('sólo cuenta el throughput de la persona filtrada', () => {
    const now = new Date('2026-06-30T00:00:00Z');
    const issues: CoreIssue[] = [
      { id: 'A', status: 'Done', assignee_id: 'u1', talla: 'M', created_at: '2026-01-01T00:00:00Z', last_transition_at: '2026-06-20T00:00:00Z' },
      { id: 'B', status: 'Done', assignee_id: 'u2', talla: 'M', created_at: '2026-01-01T00:00:00Z', last_transition_at: '2026-06-20T00:00:00Z' },
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'A', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-20T00:00:00Z' },
      { issue_id: 'B', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-20T00:00:00Z' },
    ];
    expect(computeForecast(issues, transitions, { now }).totalThroughput).toBe(2);
    expect(computeForecast(issues, transitions, { now, assignee: 'u1' }).totalThroughput).toBe(1);
  });
});
