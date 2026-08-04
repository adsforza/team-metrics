import { writeSnapshots } from '../lib/snapshots';

function makeDbStub() {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const db = {
    runAsync: jest.fn((sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve(undefined);
    }),
    withTransactionAsync: jest.fn((fn: () => Promise<void>) => fn()),
  };
  return { db: db as any, calls };
}

describe('writeSnapshots', () => {
  test('partial bundle writes only the tables present', async () => {
    const { db, calls } = makeDbStub();
    const kpi = { wip: 1, throughput: 2, cycle_time_p50: 3, cycle_time_p85: 4, blocked_count: 0 };
    const throughput = [{ week: '2026-06-23', count: 2, by_talla: { S: 1, M: 1, L: 0, XL: 0 } }];

    await writeSnapshots(db, { kpi, throughput }, '2026-07-01T00:00:00.000Z');

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);

    const sqls = calls.map(c => c.sql);
    expect(sqls.some(s => s.includes('kpi_snapshot'))).toBe(true);
    expect(sqls.some(s => s.includes('throughput_weekly'))).toBe(true);

    // Nothing else should be touched.
    expect(sqls.some(s => s.includes('scorecard_members'))).toBe(false);
    expect(sqls.some(s => s.includes('aging_issues'))).toBe(false);
    expect(sqls.some(s => s.includes('wip_risk_snapshot'))).toBe(false);
    expect(sqls.some(s => s.includes('bottleneck_snapshot'))).toBe(false);
    expect(sqls.some(s => s.includes('forecast_snapshot'))).toBe(false);
    expect(sqls.some(s => s.includes('comparison_snapshot'))).toBe(false);
    expect(sqls.some(s => s.includes('cfd_points'))).toBe(false);
    expect(sqls.some(s => s.includes('issues_snapshot'))).toBe(false);
    expect(sqls.some(s => s.includes('by_talla_snapshot'))).toBe(false);
  });

  test('empty bundle writes nothing', async () => {
    const { db, calls } = makeDbStub();
    await writeSnapshots(db, {}, '2026-07-01T00:00:00.000Z');
    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  test('comparisonWeeks prunes stale weeks and comparisons are inserted', async () => {
    const { db, calls } = makeDbStub();
    const result = { week: 'w1', prevWeek: 'w0', throughput: { current: 1, previous: 1, delta: 0, deltaPct: null }, wip: { current: 1, previous: 1, delta: 0, deltaPct: null } };

    await writeSnapshots(
      db,
      { comparisonWeeks: ['w1', 'w2'], comparisons: [{ week: 'w1', result }] },
      '2026-07-01T00:00:00.000Z'
    );

    const del = calls.find(c => c.sql.includes('DELETE FROM comparison_snapshot'));
    expect(del).toBeDefined();
    expect(del!.sql).toBe('DELETE FROM comparison_snapshot WHERE week NOT IN (?,?)');
    expect(del!.params).toEqual(['w1', 'w2']);

    const inserts = calls.filter(c => c.sql.includes('INSERT OR REPLACE INTO comparison_snapshot'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params![0]).toBe('w1');
    expect(JSON.parse(inserts[0].params![1] as string)).toEqual(result);
  });

  test('skips the prune when comparisonWeeks is undefined but still inserts comparisons', async () => {
    const { db, calls } = makeDbStub();
    const result = { week: 'w1', prevWeek: 'w0', throughput: { current: 1, previous: 1, delta: 0, deltaPct: null }, wip: { current: 1, previous: 1, delta: 0, deltaPct: null } };

    await writeSnapshots(db, { comparisons: [{ week: 'w1', result }] }, '2026-07-01T00:00:00.000Z');

    expect(calls.some(c => c.sql.includes('DELETE FROM comparison_snapshot'))).toBe(false);
    expect(calls.some(c => c.sql.includes('INSERT OR REPLACE INTO comparison_snapshot'))).toBe(true);
  });
});
