import { Header } from './components/Header/Header';
import { KPICards } from './components/KPICards/KPICards';
import { CycleTimeByTalla } from './components/CycleTimeByTalla/CycleTimeByTalla';
import { CFDChart } from './components/CFDChart/CFDChart';
import { ScatterPlot } from './components/ScatterPlot/ScatterPlot';
import { ThroughputChart } from './components/ThroughputChart/ThroughputChart';
import { AgingWIP } from './components/AgingWIP/AgingWIP';
import { TeamTable } from './components/TeamTable/TeamTable';
import { useMetrics } from './hooks/useMetrics';
import { useTeam } from './hooks/useTeam';
import { api } from './lib/api';
import { useEffect, useState } from 'react';
import type { Issue } from './lib/api';

export default function App() {
  const { kpis, byTalla, cfd, throughput, aging, loading } = useMetrics();
  const { team, loading: teamLoading } = useTeam();
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => { api.issues().then(setIssues).catch(() => {}); }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header />
      <main className="px-6 py-4 flex flex-col gap-4">
        <KPICards kpis={kpis} loading={loading} />
        <CycleTimeByTalla metrics={byTalla} />
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-3"><CFDChart data={cfd} /></div>
          <div className="col-span-2"><ScatterPlot issues={issues} kpis={kpis} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ThroughputChart data={throughput} />
          <AgingWIP issues={aging} />
        </div>
        <div className="border-t border-slate-800 pt-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-700 text-center mb-4">Comparativa del equipo</p>
          <TeamTable team={team} loading={teamLoading} />
        </div>
      </main>
    </div>
  );
}
