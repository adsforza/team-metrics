import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { isServerReachable, triggerReclassify } from '../lib/api';
import { getDirectConfig } from '../lib/directConfig';
import { directSync, directReclassify } from '../lib/directSync';
import { getDb } from '../lib/db';
import { dateRangeFor, useFilterStore } from './filterStore';
import type { SyncStatus } from '../lib/syncStatus';
import type { SyncProgress } from '../lib/progress';

export type { SyncStatus };
export type SyncMode = 'backend' | 'direct' | null;

export type ReclassifyOutcome =
  | { mode: 'backend'; pending: number }
  | { mode: 'direct'; classified: number; failCount: number }
  | { mode: 'none' };

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus;
  lastSyncMode: SyncMode;
  errors: SyncError[];
  dataVersion: number;
  progress: SyncProgress | null;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
  reclassify: () => Promise<ReclassifyOutcome>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncMode: null,
  errors: [],
  dataVersion: 0,
  progress: null,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });

    const { timeRange, assignee } = useFilterStore.getState();
    const range = dateRangeFor(timeRange);
    const onProgress = (p: SyncProgress) => set({ progress: p });

    try {
      let result;
      let mode: SyncMode;

      if (await isServerReachable()) {
        result = await performSync(range, assignee, onProgress);
        mode = 'backend';
      } else {
        const cfg = await getDirectConfig();
        if (!cfg) {
          set({ loading: false, lastSyncStatus: 'offline', progress: null });
          return;
        }
        const db = await getDb();
        result = await directSync(db, {
          boards: cfg.boards,
          geminiKey: cfg.geminiKey,
          filters: { from: range.from, to: range.to, assignee },
        }, { onProgress });
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
        progress: null,
      });
    } catch (err) {
      set({
        loading: false,
        lastSyncStatus: 'offline',
        errors: [{ endpoint: 'global', message: String(err) }],
        progress: null,
      });
    }
  },

  reclassify: async () => {
    if (get().loading) return { mode: 'none' };
    set({ loading: true, errors: [] });

    const { timeRange, assignee } = useFilterStore.getState();
    const range = dateRangeFor(timeRange);
    const onProgress = (p: SyncProgress) => set({ progress: p });

    try {
      // Con backend disponible, la reclasificación corre en el server (mejor cuota/latencia).
      if (await isServerReachable()) {
        const r = await triggerReclassify();
        set({ loading: false, progress: null });
        return { mode: 'backend', pending: r.pending ?? 0 };
      }

      const cfg = await getDirectConfig();
      if (!cfg) {
        set({ loading: false, lastSyncStatus: 'offline', progress: null });
        return { mode: 'none' };
      }
      const db = await getDb();
      const result = await directReclassify(db, {
        boards: cfg.boards,
        geminiKey: cfg.geminiKey,
        filters: { from: range.from, to: range.to, assignee },
      }, { onProgress });
      set({
        loading: false,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
        progress: null,
      });
      return { mode: 'direct', classified: result.classified, failCount: result.failCount };
    } catch (err) {
      set({ loading: false, errors: [{ endpoint: 'reclassify', message: String(err) }], progress: null });
      return { mode: 'none' };
    }
  },
}));
