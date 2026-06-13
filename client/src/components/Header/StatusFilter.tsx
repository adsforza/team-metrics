import { useFilters } from '../../store/filters';

const STATUSES = ['To Do', 'In Progress', 'In Review', 'In QA', 'Done', 'Blocked'];

export function StatusFilter() {
  const { status, setStatus } = useFilters();
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <select
        value={status}
        onChange={e => setStatus(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todos los estados</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
