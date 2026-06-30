jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sqlite', () => {
  const mockDb = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn((fn: () => Promise<void>) => fn()),
  };
  return { openDatabaseAsync: jest.fn().mockResolvedValue(mockDb) };
});

global.fetch = jest.fn();

import { performSync } from '../lib/sync';

const mockKpi = { wip: 5, throughput: 3, cycle_time_p50: 4, cycle_time_p85: 7, blocked_count: 1 };

function mockAllFetch(overrides: Record<string, unknown> = {}) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/api/metrics/throughput')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics/aging'))      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics/wip-risk'))   return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], counts: {}, limits: [], lookbackDays: 84 }) });
    if (url.includes('/api/metrics/bottleneck')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ states: [], total_active: 0, lookbackWeeks: 8 }) });
    if (url.includes('/api/metrics/forecast'))   return Promise.resolve({ ok: true, json: () => Promise.resolve({ insufficientData: true, when: null, howMany: null, items: 0, horizonDays: 14, lookbackDays: 84, trials: 10000, totalThroughput: 0 }) });
    if (url.includes('/api/metrics/comparison')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ week: '2026-06-23', prevWeek: '2026-06-16', throughput: { current: 0, previous: 0, delta: 0, deltaPct: null }, wip: { current: 0, previous: 0, delta: 0, deltaPct: null } }) });
    if (url.includes('/api/metrics/cfd'))        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/metrics'))            return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides['/api/metrics'] ?? mockKpi) });
    if (url.includes('/api/team'))               return Promise.resolve({ ok: true, json: () => Promise.resolve({ team: { delivery: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, predictability: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, focus: { value: 1, previous: 1, trend: 'flat', improving: 'steady' }, flow: { value: 1, previous: 1, trend: 'flat', improving: 'steady' } }, members: [], context: { delivery: { min:0,median:1,max:2 }, predictability: { min:0,median:1,max:2 }, focus: { min:0,median:1,max:2 }, flow: { min:0,median:1,max:2 } } }) });
    if (url.includes('/api/issues'))             return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    return Promise.reject(new Error('unmatched URL: ' + url));
  });
}

describe('performSync', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns success when all endpoints respond', async () => {
    mockAllFetch();
    const result = await performSync();
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('records an error for a failing endpoint but continues', async () => {
    mockAllFetch();
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 503 })
    );
    const result = await performSync();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });
});
