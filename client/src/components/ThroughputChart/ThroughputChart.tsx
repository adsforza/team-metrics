import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ThroughputWeek } from '../../lib/api';
import { formatDate, TALLA_COLOR } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

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
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Throughput semanal</h3>
      <p className="text-xs text-slate-600 mb-4">Issues cerrados por semana y talla</p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData}>
          <XAxis dataKey="week" tickFormatter={w => formatDate(w)} tick={{ fontSize: 9, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 9, fill: '#475569' }} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
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
  );
}
