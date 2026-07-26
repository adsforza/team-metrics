import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import type { KPIMetrics, Issue } from '../../lib/api';
import { TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

interface ScatterPoint {
  x: number;
  y: number;
  talla: Talla | null;
  id: string;
}

interface Props {
  issues: Issue[];
  kpis: KPIMetrics | null;
}

export function ScatterPlot({ issues, kpis }: Props) {
  const data: ScatterPoint[] = issues
    .filter((i): i is Issue & { ct_days: number } => i.ct_days != null)
    .map((i, idx) => ({ x: idx, y: i.ct_days, talla: i.talla, id: i.id }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full">
      <div className="flex items-center gap-1.5 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cycle Time Scatterplot</h3>
        <InfoTooltip text="Cada punto es un issue Done: su altura es cuántos días tardó de In Progress a Done. Las líneas punteadas marcan p50 (mediana) y p85 del equipo, para ver qué tan disperso es el cycle time." />
      </div>
      <p className="text-xs text-slate-600 mb-2">Coloreado por talla</p>
      <div className="flex gap-3 mb-3">
        {(['S', 'M', 'L', 'XL'] as Talla[]).map(t => (
          <span key={t} className="flex items-center gap-1 text-xs text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TALLA_COLOR[t] }} />
            {t}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart>
          <XAxis dataKey="x" hide />
          <YAxis dataKey="y" tick={{ fontSize: 10, fill: '#94a3b8' }} unit="d" domain={[0, kpis?.cycle_time_p85 ? kpis.cycle_time_p85 * 1.3 : 10]} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#cbd5e1' }}
            itemStyle={{ color: '#e2e8f0' }}
            formatter={(v: unknown) => [`${Number(v).toFixed(1)}d`, 'Cycle Time']}
          />
          <Scatter data={data} fill="#94a3b8">
            {data.map(d => (
              <Cell key={d.id} fill={d.talla ? TALLA_COLOR[d.talla] : '#64748b'} />
            ))}
          </Scatter>
          {kpis?.cycle_time_p50 != null && (
            <ReferenceLine
              y={kpis.cycle_time_p50}
              stroke="#a78bfa"
              strokeDasharray="4 3"
              label={{ value: 'p50', fill: '#a78bfa', fontSize: 9 }}
            />
          )}
          {kpis?.cycle_time_p85 != null && (
            <ReferenceLine
              y={kpis.cycle_time_p85}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              label={{ value: 'p85', fill: '#f59e0b', fontSize: 9 }}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      {data.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center -mt-2">Sin issues completados en el período</p>
      )}
      {data.length > 0 && (
        <p className="text-[10px] text-slate-600 text-center -mt-2">{data.length} issues</p>
      )}
    </div>
  );
}
