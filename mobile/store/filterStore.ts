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
  assignees: string[];          // [] = todos (OJO: el core usa la convencion opuesta)
  talla: Talla | null;
  timeRange: TimeRange;
  setAssignees: (ids: string[]) => void;
  toggleAssignee: (id: string) => void;
  clearAssignees: () => void;
  setTalla: (t: Talla | null) => void;
  setTimeRange: (r: TimeRange) => void;
}

// v0 guardaba `assignee: string | null`. Sin esto, un celular ya instalado abre
// con assignees undefined y rompe al iterarlo.
export function migrateFilters(persisted: any, version: number): any {
  if (version >= 1) return persisted;
  const { assignee, ...rest } = persisted ?? {};
  return { ...rest, assignees: assignee ? [assignee] : [] };
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      assignees: [],
      talla: null,
      timeRange: '30d',
      setAssignees: (assignees) => set({ assignees }),
      toggleAssignee: (id) => set(s => ({
        assignees: s.assignees.includes(id)
          ? s.assignees.filter(a => a !== id)
          : [...s.assignees, id],
      })),
      clearAssignees: () => set({ assignees: [] }),
      setTalla: (talla) => set({ talla }),
      setTimeRange: (timeRange) => set({ timeRange }),
    }),
    {
      name: 'tm-filters',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      migrate: migrateFilters,
    }
  )
);
