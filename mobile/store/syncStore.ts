import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { isServerReachable } from '../lib/api';
import { dateRangeFor, useFilterStore } from './filterStore';

export type SyncStatus = 'ok' | 'partial' | 'offline' | null;

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus;
  errors: SyncError[];
  dataVersion: number;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  errors: [],
  dataVersion: 0,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });

    if (!(await isServerReachable())) {
      set({ loading: false, lastSyncStatus: 'offline' });
      return;
    }

    try {
      const { timeRange, assignee } = useFilterStore.getState();
      const result = await performSync(dateRangeFor(timeRange), assignee);
      const status: SyncStatus =
        result.okCount === 0 ? 'offline' : result.failCount > 0 ? 'partial' : 'ok';
      set({
        loading: false,
        lastSyncStatus: status,
        lastSyncedAt: result.okCount > 0 ? result.syncedAt : get().lastSyncedAt,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
      });
    } catch (err) {
      set({
        loading: false,
        lastSyncStatus: 'offline',
        errors: [{ endpoint: 'global', message: String(err) }],
      });
    }
  },
}));
