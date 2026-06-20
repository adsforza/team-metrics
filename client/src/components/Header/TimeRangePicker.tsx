import { useFilters, type TimeRange } from '../../store/filters';

const RANGES: Exclude<TimeRange, 'custom'>[] = ['7d', '14d', '30d', '90d'];

export function TimeRangePicker() {
  const { timeRange, customFrom, customTo, setTimeRange, setCustomRange } = useFilters();

  return (
    <div className="flex items-center gap-2">
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
      <div
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border transition-colors ${
          timeRange === 'custom' ? 'border-blue-600 bg-slate-800' : 'border-slate-700 bg-slate-800'
        }`}
        title="Rango de fechas específico"
      >
        <input
          type="date"
          value={customFrom}
          max={customTo || undefined}
          onChange={e => setCustomRange(e.target.value, customTo || e.target.value)}
          className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer [color-scheme:dark]"
        />
        <span className="text-slate-600 text-xs">→</span>
        <input
          type="date"
          value={customTo}
          min={customFrom || undefined}
          onChange={e => setCustomRange(customFrom || e.target.value, e.target.value)}
          className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer [color-scheme:dark]"
        />
      </div>
    </div>
  );
}
