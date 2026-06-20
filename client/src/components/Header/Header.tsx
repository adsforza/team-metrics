import { TimeRangePicker } from './TimeRangePicker';
import { PersonFilter } from './PersonFilter';
import { TallaFilter } from './TallaFilter';
import { StatusFilter } from './StatusFilter';
import { useFilters } from '../../store/filters';
import { useTeam } from '../../hooks/useTeam';
import { api } from '../../lib/api';
import { useState } from 'react';

export function Header() {
  const { assignee, talla, status, timeRange, customFrom, customTo } = useFilters();
  const { members } = useTeam();
  const [syncing, setSyncing] = useState(false);
  const assigneeName = members.find(m => m.id === assignee)?.display_name;
  const hasFilter = !!(assignee || talla || status);

  const rangeLabel = timeRange === 'custom' && customFrom && customTo
    ? `${customFrom} → ${customTo}`
    : `últimos ${timeRange}`;

  const activeParts = [
    assigneeName && `${assigneeName}`,
    talla && `talla ${talla}`,
    status && status,
    rangeLabel,
  ].filter(Boolean).join(' · ');

  return (
    <header className="border-b border-slate-800 px-6 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="mr-2">
          <h1 className="text-base font-semibold text-white">⚡ TeamMetrics</h1>
          <p className="text-xs text-slate-500">DevOps Board</p>
        </div>
        <TimeRangePicker />
        <PersonFilter />
        <TallaFilter />
        <StatusFilter />
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-1 rounded-full">✦ IA clasifica tallas</span>
        <button
          onClick={() => { setSyncing(true); api.syncNow().finally(() => setSyncing(false)); }}
          disabled={syncing}
          className="ml-auto text-xs text-slate-400 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg hover:text-white transition-colors disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : '↻ Sync'}
        </button>
      </div>
      {hasFilter && (
        <div className="mt-2 text-xs text-blue-300 bg-blue-950 border border-blue-800 rounded-lg px-3 py-1.5">
          Mostrando: <strong>{activeParts}</strong>
        </div>
      )}
    </header>
  );
}
