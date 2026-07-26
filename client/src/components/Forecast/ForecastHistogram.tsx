import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { ForecastBin } from '../../lib/api';

interface Mark { x: number; label: string }

interface Props {
  bins: ForecastBin[];
  marks: Mark[];
  unit: string; // e.g. 'días' or 'issues'
}

export function ForecastHistogram({ bins, marks, unit }: Props) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={bins} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="x"
          type="number"
          domain={['dataMin', 'dataMax']}
          tick={{ fontSize: 10, fill: '#64748b' }}
          label={{ value: unit, fontSize: 9, fill: '#94a3b8', position: 'insideBottomRight', offset: -2 }}
        />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={28} />
        <Bar dataKey="count" fill="#3b82f6" fillOpacity={0.55} isAnimationActive={false} />
        {marks.map(m => (
          <ReferenceLine
            key={m.label}
            x={m.x}
            stroke="#cbd5e1"
            strokeDasharray="3 3"
            label={{ value: m.label, fontSize: 9, fill: '#94a3b8', position: 'top' }}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
