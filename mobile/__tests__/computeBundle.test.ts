import { computeBundle } from '../lib/directSync';
import { readUnclassifiedIssues, updateIssueTallas } from '../lib/db';
import type { CoreIssueWorkload, CoreTransition, CoreMember } from '@teammetrics/core/types';

const NOW = new Date('2026-07-01T00:00:00Z');

const issues: CoreIssueWorkload[] = [
  {
    id: 'A', title: 'Issue A', status: 'Done', assignee_id: 'u1', talla: 'M',
    created_at: '2026-06-01T00:00:00Z', last_transition_at: '2026-06-05T00:00:00Z',
    requester: null, priority: null, boards: [],
  },
  {
    id: 'B', title: 'Issue B', status: 'In Progress', assignee_id: 'u2', talla: 'L',
    created_at: '2026-06-10T00:00:00Z', last_transition_at: '2026-06-11T00:00:00Z',
    requester: null, priority: null, boards: [],
  },
  {
    id: 'C', title: 'Issue C', status: 'To Do', assignee_id: null, talla: null,
    created_at: '2026-06-15T00:00:00Z', last_transition_at: '2026-06-15T00:00:00Z',
    requester: null, priority: null, boards: [],
  },
];

const transitions: CoreTransition[] = [
  { issue_id: 'A', from_status: null, to_status: 'To Do', transitioned_at: '2026-06-01T00:00:00Z' },
  { issue_id: 'A', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-02T00:00:00Z' },
  { issue_id: 'A', from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-06-05T00:00:00Z' },
  { issue_id: 'B', from_status: null, to_status: 'To Do', transitioned_at: '2026-06-10T00:00:00Z' },
  { issue_id: 'B', from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-06-11T00:00:00Z' },
  { issue_id: 'C', from_status: null, to_status: 'To Do', transitioned_at: '2026-06-15T00:00:00Z' },
];

const members: CoreMember[] = [
  { id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null },
  { id: 'u2', display_name: 'Bob', email: 'b@t.com', avatar_url: null },
];

describe('computeBundle', () => {
  it('runs all core computes and returns a fully-shaped SnapshotBundle', () => {
    const bundle = computeBundle(issues, transitions, members, {}, NOW);

    expect(typeof bundle.kpi!.wip).toBe('number');
    expect(Array.isArray(bundle.throughput)).toBe(true);
    expect(bundle.team).toBeDefined();
    expect(Array.isArray(bundle.team!.members)).toBe(true);
    expect(Array.isArray(bundle.aging)).toBe(true);
    expect(bundle.wipRisk).toBeDefined();
    expect(bundle.bottleneck).toBeDefined();
    expect(bundle.forecast).toBeDefined();
    expect(Array.isArray(bundle.cfd)).toBe(true);
    expect(Array.isArray(bundle.byTalla)).toBe(true);

    expect(bundle.comparisonWeeks).toHaveLength(6);
    expect(bundle.comparisons).toHaveLength(6);
    for (const c of bundle.comparisons!) {
      expect(c.week).toEqual(expect.any(String));
      expect(c.result.week).toBe(c.week);
    }
  });

  it('maps issues to the mobile Issue shape, computing ct_days like /api/issues', () => {
    const bundle = computeBundle(issues, transitions, members, {}, NOW);
    const byId = new Map(bundle.issues!.map(i => [i.id, i]));

    const a = byId.get('A')!;
    expect(a.title).toBe('Issue A');
    expect(a.status).toBe('Done');
    // start_at = first "In Progress" transition (2026-06-02), end_at = "Done" transition (2026-06-05) -> 3 days
    expect(a.ct_days).toBe(3);

    const b = byId.get('B')!;
    expect(b.status).toBe('In Progress');
    expect(b.ct_days).toBeNull(); // not currently Done -> null, matching server formula

    const c = byId.get('C')!;
    expect(c.status).toBe('To Do');
    expect(c.ct_days).toBeNull();
  });

  it('is pure w.r.t. `now`: identical inputs + `now` reproduce every deterministic field', () => {
    // computeForecast falls back to Math.random() when no rng is injected (computeBundle's
    // signature, per spec, takes no rng param), so its Monte Carlo histograms legitimately
    // vary run-to-run. Everything else must match exactly.
    const b1 = computeBundle(issues, transitions, members, {}, NOW);
    const b2 = computeBundle(issues, transitions, members, {}, NOW);
    const strip = (b: typeof b1) => ({ ...b, forecast: undefined });
    expect(strip(b1)).toEqual(strip(b2));
    expect(b1.forecast!.insufficientData).toBe(b2.forecast!.insufficientData);
  });

  it('incluye workload en el bundle', () => {
    const bundle = computeBundle(
      [{ id: 'A', title: 't', status: 'Backlog', assignee_id: null, talla: null,
         created_at: '2026-06-10T00:00:00.000Z', last_transition_at: null,
         requester: 'Groot', priority: null, boards: [9534] } as any],
      [], [], { from: '2026-06-01', to: '2026-06-30' },
      new Date('2026-06-30T00:00:00.000Z'),
      [{ id: 9534, name: 'Black Team Infra' }],
    );
    expect(bundle.workload!.squads[0].requesters[0].requester).toBe('Groot');
  });
});

function stubDb(rowsBySql: (sql: string, args?: any[]) => any) {
  const calls: { sql: string; args?: any[] }[] = [];
  const db: any = {
    getAllAsync: async (sql: string, args?: any[]) => { calls.push({ sql, args }); return rowsBySql(sql, args); },
    runAsync: async (sql: string, args?: any[]) => { calls.push({ sql, args }); return rowsBySql(sql, args); },
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
  };
  return { db, calls };
}

describe('readUnclassifiedIssues', () => {
  it('selects id/title/description for issues with no talla', async () => {
    const rows = [{ id: 'X', title: 'T', description: 'D' }];
    const { db, calls } = stubDb(() => rows);
    const res = await readUnclassifiedIssues(db);
    expect(res).toEqual(rows);
    expect(calls[0].sql).toContain('SELECT id, title, description FROM issues');
    expect(calls[0].sql).toContain('WHERE talla IS NULL');
  });
});

describe('updateIssueTallas', () => {
  it('updates talla + talla_confidence for each non-null result, in a transaction', async () => {
    const { db, calls } = stubDb(() => undefined);
    await updateIssueTallas(db, new Map([
      ['X', { talla: 'M', confidence: 0.9 }],
      ['Y', { talla: null, confidence: 0 }],
    ]));
    const updateCalls = calls.filter(c => c.sql.startsWith('UPDATE issues'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].sql).toContain('SET talla=?, talla_confidence=?');
    expect(updateCalls[0].args).toEqual(['M', 0.9, 'X']);
  });
});
