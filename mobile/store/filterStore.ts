import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Talla } from '../lib/types';

interface FilterState {
  assignee: string | null;
  talla: Talla | null;
  setAssignee: (a: string | null) => void;
  setTalla: (t: Talla | null) => void;
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      assignee: null,
      talla: null,
      setAssignee: (assignee) => set({ assignee }),
      setTalla: (talla) => set({ talla }),
    }),
    {
      name: 'tm-filters',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
