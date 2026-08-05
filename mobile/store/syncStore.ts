import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { isServerReachable } from '../lib/api';
import { getDirectConfig } from '../lib/directConfig';
import { directSync } from '../lib/directSync';
import { getDb } from '../lib/db';
import { dateRangeFor, useFilterStore } from './filterStore';
import type { SyncStatus } from '../lib/syncStatus';

export type { SyncStatus };
export type SyncMode = 'backend' | 'direct' | null;

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus;
  lastSyncMode: SyncMode;
  errors: SyncError[];
  dataVersion: number;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncMode: null,
  errors: [],
  dataVersion: 0,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });

    const { timeRange, assignee } = useFilterStore.getState();
    const range = dateRangeFor(timeRange);

    try {
      let result;
      let mode: SyncMode;

      if (await isServerReachable()) {
        result = await performSync(range, assignee);
        mode = 'backend';
      } else {
        const cfg = await getDirectConfig();
        if (!cfg) {
          set({ loading: false, lastSyncStatus: 'offline' });
          return;
        }
        const db = await getDb();
        result = await directSync(db, {
          boards: cfg.boards,
          geminiKey: cfg.geminiKey,
          filters: { from: range.from, to: range.to, assignee },
        });
        mode = 'direct';
      }

      const status: SyncStatus =
        result.okCount === 0 ? 'offline' : result.failCount > 0 ? 'partial' : 'ok';
      set({
        loading: false,
        lastSyncStatus: status,
        lastSyncMode: mode,
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
