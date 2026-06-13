import { create } from 'zustand';

export type TimeRange = '7d' | '14d' | '30d' | '90d';

interface FiltersState {
  timeRange: TimeRange;
  assignee: string;
  talla: string;
  status: string;
  setTimeRange: (r: TimeRange) => void;
  setAssignee: (a: string) => void;
  setTalla: (t: string) => void;
  setStatus: (s: string) => void;
  toQueryParams: () => Record<string, string | undefined>;
}

function getDateRange(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[range];
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export const useFilters = create<FiltersState>((set, get) => ({
  timeRange: '30d',
  assignee: '',
  talla: '',
  status: '',
  setTimeRange: (timeRange) => set({ timeRange }),
  setAssignee: (assignee) => set({ assignee }),
  setTalla: (talla) => set({ talla }),
  setStatus: (status) => set({ status }),
  toQueryParams: () => {
    const { timeRange, assignee, talla, status } = get();
    const { from, to } = getDateRange(timeRange);
    return {
      from,
      to,
      assignee: assignee || undefined,
      talla: talla || undefined,
      status: status || undefined,
    };
  },
}));
