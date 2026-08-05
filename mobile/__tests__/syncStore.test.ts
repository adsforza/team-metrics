jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/api', () => ({ isServerReachable: jest.fn() }));
jest.mock('../lib/sync', () => ({ performSync: jest.fn() }));
jest.mock('../lib/directConfig', () => ({ getDirectConfig: jest.fn() }));
jest.mock('../lib/directSync', () => ({ directSync: jest.fn() }));
jest.mock('../lib/db', () => ({ getDb: jest.fn().mockResolvedValue({}) }));

import { isServerReachable } from '../lib/api';
import { performSync } from '../lib/sync';
import { getDirectConfig } from '../lib/directConfig';
import { directSync } from '../lib/directSync';
import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';

const reset = () => useSyncStore.setState({
  loading: false, lastSyncedAt: 'PREV', errors: [], dataVersion: 0, lastSyncStatus: null, lastSyncMode: null,
});

describe('syncStore.sync', () => {
  beforeEach(() => { jest.clearAllMocks(); reset(); });

  test('offline cuando el server no es alcanzable y no hay config directa, preserva timestamp y no sincroniza', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(false);
    (getDirectConfig as jest.Mock).mockResolvedValue(null);
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('offline');
    expect(s.lastSyncedAt).toBe('PREV');
    expect(s.lastSyncMode).toBe(null);
    expect(performSync).not.toHaveBeenCalled();
    expect(directSync).not.toHaveBeenCalled();
    expect(s.loading).toBe(false);
  });

  test('offline cuando reachable pero okCount 0, sin pisar timestamp', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: false, errors: [{}], syncedAt: 'NOW', okCount: 0, failCount: 16 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('offline');
    expect(s.lastSyncedAt).toBe('PREV');
  });

  test('partial cuando hay fallos parciales, actualiza timestamp', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: false, errors: [{}], syncedAt: 'NOW', okCount: 10, failCount: 6 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('partial');
    expect(s.lastSyncedAt).toBe('NOW');
  });

  test('ok cuando todo responde, modo backend', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: true, errors: [], syncedAt: 'NOW', okCount: 16, failCount: 0 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('ok');
    expect(s.lastSyncedAt).toBe('NOW');
    expect(s.lastSyncMode).toBe('backend');
    expect(directSync).not.toHaveBeenCalled();
    expect(getDirectConfig).not.toHaveBeenCalled();
  });

  test('modo direct cuando no reachable pero hay config directa', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(false);
    const cfg = { boards: [{ boardId: 1 }], geminiKey: 'gk' };
    (getDirectConfig as jest.Mock).mockResolvedValue(cfg);
    (directSync as jest.Mock).mockResolvedValue({ success: true, errors: [], syncedAt: 'NOW', okCount: 3, failCount: 0 });
    useFilterStore.setState({ assignee: 'user-1' });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(performSync).not.toHaveBeenCalled();
    expect(directSync).toHaveBeenCalledTimes(1);
    const [dbArg, configArg] = (directSync as jest.Mock).mock.calls[0];
    expect(dbArg).toEqual({});
    expect(configArg).toEqual({
      boards: cfg.boards,
      geminiKey: cfg.geminiKey,
      filters: { from: expect.any(String), to: expect.any(String), assignee: 'user-1' },
    });
    expect(s.lastSyncMode).toBe('direct');
    expect(s.lastSyncStatus).toBe('ok');
    expect(s.lastSyncedAt).toBe('NOW');
  });

  test('partial en modo direct cuando hay fallos', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(false);
    (getDirectConfig as jest.Mock).mockResolvedValue({ boards: [], geminiKey: 'gk' });
    (directSync as jest.Mock).mockResolvedValue({ success: false, errors: [{}], syncedAt: 'NOW', okCount: 2, failCount: 1 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncMode).toBe('direct');
    expect(s.lastSyncStatus).toBe('partial');
    expect(s.lastSyncedAt).toBe('NOW');
  });
});
