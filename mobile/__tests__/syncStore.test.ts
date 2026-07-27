jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/api', () => ({ isServerReachable: jest.fn() }));
jest.mock('../lib/sync', () => ({ performSync: jest.fn() }));

import { isServerReachable } from '../lib/api';
import { performSync } from '../lib/sync';
import { useSyncStore } from '../store/syncStore';

const reset = () => useSyncStore.setState({
  loading: false, lastSyncedAt: 'PREV', errors: [], dataVersion: 0, lastSyncStatus: null,
});

describe('syncStore.sync', () => {
  beforeEach(() => { jest.clearAllMocks(); reset(); });

  test('offline cuando el server no es alcanzable, preserva timestamp y no sincroniza', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(false);
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('offline');
    expect(s.lastSyncedAt).toBe('PREV');
    expect(performSync).not.toHaveBeenCalled();
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

  test('ok cuando todo responde', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: true, errors: [], syncedAt: 'NOW', okCount: 16, failCount: 0 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('ok');
    expect(s.lastSyncedAt).toBe('NOW');
  });
});
