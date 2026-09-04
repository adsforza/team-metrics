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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { performSync, LAST_SYNCED_KEY, pushPendingTallas } from '../lib/sync';
import { getDb } from '../lib/db';

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
    if (url.includes('/api/workload'))           return Promise.resolve({ ok: true, json: () => Promise.resolve({ squads: [], totals: { pedidos: 0, pendientes: 0, compartidos: 0 } }) });
    if (url.includes('/api/raw'))  return Promise.resolve({ ok: true, json: () => Promise.resolve({ issues: [], transitions: [], members: [], serverSyncedAt: '2026-06-21T00:05:00Z' }) });
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

  test('reporta okCount/failCount y NO escribe LAST_SYNCED_KEY si todo falla', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const result = await performSync();
    expect(result.okCount).toBe(0);
    expect(result.failCount).toBeGreaterThan(0);
    expect(result.success).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(LAST_SYNCED_KEY, expect.anything());
  });

  test('escribe LAST_SYNCED_KEY cuando al menos un endpoint responde', async () => {
    mockAllFetch();
    const result = await performSync();
    expect(result.okCount).toBeGreaterThan(0);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LAST_SYNCED_KEY, result.syncedAt);
  });

  test('performSync baja el crudo del server y setea el sentinela board_sync[0]', async () => {
    mockAllFetch();
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await performSync();
    // pegó a /api/raw
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/raw'), expect.anything());
    // seteó el sentinela board_sync con board_id 0 y el serverSyncedAt
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INTO board_sync'),
      [0, '2026-06-21T00:05:00Z', null],
    );
  });

  test('reporta progreso via onProgress', async () => {
    mockAllFetch();
    const onProgress = jest.fn();
    await performSync(undefined, undefined, onProgress);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('métricas') }));
  });
});

describe('pushPendingTallas', () => {
  beforeEach(() => jest.clearAllMocks());

  test('empuja pendientes y las marca', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ updated: 1 }) });
    const res = await pushPendingTallas(db);
    expect(res).toEqual({ pushed: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/tallas'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('talla_pushed = 1'), ['X']);
  });

  test('no-op cuando no hay pendientes', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([]);
    const res = await pushPendingTallas(db);
    expect(res).toEqual({ pushed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('devuelve error string si el POST falla', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    const res = await pushPendingTallas(db);
    expect(res.pushed).toBe(0);
    expect(res.error).toContain('500');
  });
});
