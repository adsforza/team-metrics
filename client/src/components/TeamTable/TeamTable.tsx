import type { TeamScorecardResponse, ScorecardDimensions } from '../../lib/api';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import { DimensionCell } from './DimensionCell';

const fmtInt = (v: number) => `${Math.round(v)}`;
const fmtRatio = (v: number) => v.toFixed(1);
const fmtPct = (v: number) => `${Math.round(v)}%`;

const COLUMNS = [
  { key: 'delivery' as const, label: 'Entrega', format: fmtInt,
    info: 'Throughput ponderado por talla (S=1, M=2, L=4, XL=8) de los issues que la persona llevó a Done en el rango. Más alto es mejor.' },
  { key: 'predictability' as const, label: 'Predecibilidad', format: fmtRatio,
    info: 'Qué tan consistente es su cycle time: ratio p85/p50. Cerca de 1 = entregas predecibles; alto = muy variable. Más bajo es mejor.' },
  { key: 'focus' as const, label: 'Foco', format: fmtRatio,
    info: 'WIP concurrente promedio: cuántos issues activos tuvo en paralelo. Más bajo = más enfocado.' },
  { key: 'flow' as const, label: 'Flujo', format: fmtPct,
    info: 'Flow efficiency: % del cycle time en que el trabajo avanzó (estados activos) vs. esperó o estuvo bloqueado. Más alto es mejor.' },
];

function Initials({ name }: { name: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-200 flex-shrink-0">
      {name.split(' ').map(n => n[0]).join('').slice(0, 2)}
    </div>
  );
}

interface Props {
  scorecard: TeamScorecardResponse;
  loading: boolean;
}

export function TeamTable({ scorecard, loading }: Props) {
  const { team, members, context } = scorecard;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rendimiento por persona</h3>
        <InfoTooltip text="Cuatro señales de flujo por persona. La flecha compara con el período anterior (verde = mejora, ámbar = empeora). La barrita ubica a la persona contra la mediana del equipo (marca clara), como contexto, no como ranking." />
      </div>
      <p className="text-xs text-slate-600 mb-4">Entrega · Predecibilidad · Foco · Flujo — tendencia vs. período anterior</p>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-700 rounded animate-pulse" />)}
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">Persona</th>
              {COLUMNS.map(col => (
                <th key={col.key} className="text-left pb-2">
                  <span className="inline-flex items-center gap-1">{col.label}<InfoTooltip text={col.info} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-700 bg-slate-900/40">
              <td className="py-2.5 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Equipo</td>
              {COLUMNS.map(col => (
                <DimensionCell key={col.key} dim={team[col.key]} context={context[col.key]} format={col.format} showContext={false} />
              ))}
            </tr>
            {members.map(p => (
              <tr key={p.member.id} className="border-t border-slate-700 hover:bg-slate-700/40">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Initials name={p.member.display_name} />
                    <div className="text-slate-200 font-medium">{p.member.display_name}</div>
                  </div>
                </td>
                {COLUMNS.map(col => (
                  <DimensionCell key={col.key} dim={(p as ScorecardDimensions)[col.key]} context={context[col.key]} format={col.format} />
                ))}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-4 text-center text-slate-600">Sin datos de equipo</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
