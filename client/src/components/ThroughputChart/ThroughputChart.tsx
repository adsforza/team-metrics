import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ThroughputWeek } from '../../lib/api';
import { formatDate, TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

interface Props {
  data: ThroughputWeek[];
}

export function ThroughputChart({ data }: Props) {
  const chartData = data.map(w => ({
    week: w.week,
    ...w.by_talla,
    total: w.count,
  }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-center gap-1.5 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Throughput semanal</h3>
        <InfoTooltip text="Cantidad de issues que llegaron a Done cada semana, apilados por talla. Mide cuánto está entregando el equipo, no cuánto trabajo hay en curso." />
      </div>
      <p className="text-xs text-slate-600 mb-4">Issues cerrados por semana y talla</p>
      <div className="flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="week" tickFormatter={w => formatDate(w)} tick={{ fontSize: 9, fill: '#475569' }} />
            <YAxis tick={{ fontSize: 9, fill: '#475569' }} />
            <Tooltip
              contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#cbd5e1' }}
              itemStyle={{ color: '#e2e8f0' }}
              labelFormatter={formatDate}
            />
            {(['S', 'M', 'L', 'XL'] as Talla[]).map(t => (
              <Bar
                key={t}
                dataKey={t}
                stackId="a"
                fill={TALLA_COLOR[t]}
                name={t}
                radius={t === 'XL' ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
