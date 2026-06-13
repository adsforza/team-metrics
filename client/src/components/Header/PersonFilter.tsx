import { useFilters } from '../../store/filters';
import { useTeam } from '../../hooks/useTeam';

export function PersonFilter() {
  const { assignee, setAssignee } = useFilters();
  const { members } = useTeam();

  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
      <select
        value={assignee}
        onChange={e => setAssignee(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todos</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.display_name}</option>
        ))}
      </select>
    </div>
  );
}
