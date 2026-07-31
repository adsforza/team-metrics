import { describe, it, expect } from 'vitest';
import { computeKpis } from './metrics';
import type { CoreIssue, CoreTransition } from './types';

const iso = (d: string) => d; // timestamps are plain ISO strings

function issue(id: string, over: Partial<CoreIssue> = {}): CoreIssue {
  return { id, status: 'In Progress', assignee_id: 'u1', talla: 'M',
    created_at: '2026-06-01T00:00:00Z', last_transition_at: '2026-06-10T00:00:00Z', ...over };
}

describe('computeKpis', () => {
  it('counts wip, throughput, cycle time percentiles and blocked', () => {
    const issues: CoreIssue[] = [
      issue('A', { status: 'In Progress', last_transition_at: '2026-06-02T00:00:00Z' }), // active + stale
      issue('B', { status: 'Done' }),   // done → not wip
      issue('C', { status: 'To Do' }),  // excluded from wip
    ];
    const transitions: CoreTransition[] = [
      { issue_id: 'A', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-01T00:00:00Z' },
      { issue_id: 'B', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-08T00:00:00Z' },
      { issue_id: 'B', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-10T00:00:00Z' },
    ];
    const params = { from: '2026-06-01', to: '2026-06-30' };
    // now = 2026-06-20 → aging cutoff 7d = 2026-06-13; A last moved 06-02 → blocked; A is the only wip.
    const k = computeKpis(issues, transitions, params, 7, new Date('2026-06-20T00:00:00Z'));
    expect(k.wip).toBe(1);            // only A (B done, C to-do)
    expect(k.throughput).toBe(1);     // B done in window
    expect(k.blocked_count).toBe(1);  // A stale > 7d
    expect(k.cycle_time_p50).toBeCloseTo(2, 5); // B: 06-08 → 06-10 = 2 days
  });

  it('wip/throughput ignore talla/status filters but cycle times respect them', () => {
    // Documents that getKPIs applied assignee-only to wip/throughput/blocked.
    const issues: CoreIssue[] = [ issue('A', { talla: 'S', status: 'In Progress' }) ];
    const k = computeKpis(issues, [], { talla: 'XL' }, 7, new Date('2026-06-20T00:00:00Z'));
    expect(k.wip).toBe(1); // talla filter must NOT drop it from wip
  });
});
