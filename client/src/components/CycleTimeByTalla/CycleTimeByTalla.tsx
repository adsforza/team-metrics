import type { TallaMetric } from '../../lib/api';
import { formatDays, TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

const LABELS: Record<Talla, string> = { S: 'Simple', M: 'Moderado', L: 'Complejo', XL: 'Muy complejo' };

// Mismas definiciones que usa el prompt de clasificación en services/claude.ts,
// para que el tooltip no se desincronice de lo que realmente clasifica la IA.
const TALLA_INFO: Record<Talla, string> = {
  S: 'Simple: cambio de configuración, fix trivial, tarea de 1 paso.',
  M: 'Moderado: cambio con algunos pasos, impacta 1-2 servicios.',
  L: 'Complejo: requiere coordinación, impacta múltiples sistemas o tiene riesgo.',
  XL: 'Muy complejo: migración, incidente mayor, trabajo de semanas.',
};

function TallaCard({ metric }: { metric: TallaMetric }) {
  const faster = metric.team_ct_p50 !== null && metric.ct_p50 !== null && metric.ct_p50 < metric.team_ct_p50;
  const color = TALLA_COLOR[metric.talla];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-black" style={{ background: color + '20', color }}>
          {metric.talla}
        </span>
        <span className="text-xs text-slate-500">{LABELS[metric.talla]}</span>
        <InfoTooltip text={TALLA_INFO[metric.talla]} />
      </div>
      <div className="text-2xl font-bold" style={{ color }}>
        {formatDays(metric.ct_p50)}
      </div>
      {metric.team_ct_p50 !== null && (
        <div className={`text-xs mt-1 ${faster ? 'text-emerald-400' : 'text-amber-400'}`}>
          {faster ? '✓' : '↑'} Equipo: {formatDays(metric.team_ct_p50)}
        </div>
      )}
      {metric.ct_p50 === null && <div className="text-xs text-slate-600 mt-1">Sin datos</div>}
    </div>
  );
}

interface Props {
  metrics: TallaMetric[];
}

export function CycleTimeByTalla({ metrics }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cycle Time por talla</h3>
        <InfoTooltip text="Cycle time mediano (p50) de los issues Done, agrupado por talla S/M/L/XL. La talla la clasifica un modelo de IA según título y descripción del issue. ✓ verde = más rápido que el promedio del equipo." />
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-0.5 rounded-full">✦ IA</span>
      </div>
      <p className="text-xs text-slate-600 mb-4">Tiempo promedio por complejidad</p>
      <div className="grid grid-cols-4 gap-3">
        {metrics.map(m => (
          <TallaCard key={m.talla} metric={m} />
        ))}
      </div>
    </div>
  );
}
