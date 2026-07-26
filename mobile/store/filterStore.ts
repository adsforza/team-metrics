import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Talla } from '../lib/types';

export type TimeRange = '30d' | '60d' | '90d' | '180d' | '360d';

const DAYS: Record<TimeRange, number> = { '30d': 30, '60d': 60, '90d': 90, '180d': 180, '360d': 360 };

export function dateRangeFor(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - DAYS[range]);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

interface FilterState {
  assignee: string | null;
  talla: Talla | null;
  timeRange: TimeRange;
  setAssignee: (a: string | null) => void;
  setTalla: (t: Talla | null) => void;
  setTimeRange: (r: TimeRange) => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      assignee: null,
      talla: null,
      timeRange: '30d',
      setAssignee: (assignee) => set({ assignee }),
      setTalla: (talla) => set({ talla }),
      setTimeRange: (timeRange) => set({ timeRange }),
    }),
    {
      name: 'tm-filters',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
