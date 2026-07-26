import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { dateRangeFor, useFilterStore } from './filterStore';

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  errors: SyncError[];
  dataVersion: number;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  errors: [],
  dataVersion: 0,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });
    try {
      const { timeRange, assignee } = useFilterStore.getState();
      const result = await performSync(dateRangeFor(timeRange), assignee);
      set({
        loading: false,
        lastSyncedAt: result.syncedAt,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
      });
    } catch (err) {
      set({
        loading: false,
        errors: [{ endpoint: 'global', message: String(err) }],
      });
    }
  },
}));
