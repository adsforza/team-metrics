import { useFilters, type TimeRange } from '../../store/filters';

const RANGES: TimeRange[] = ['7d', '14d', '30d', '90d'];

export function TimeRangePicker() {
  const { timeRange, setTimeRange } = useFilters();
  return (
    <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
      {RANGES.map(r => (
        <button
          key={r}
          onClick={() => setTimeRange(r)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            timeRange === r ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
