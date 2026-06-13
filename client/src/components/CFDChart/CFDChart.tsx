import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { CFDPoint } from '../../lib/api';
import { formatDate } from '../../lib/formatters';

const AREAS = [
  { key: 'done', color: '#166534', label: 'Done' },
  { key: 'in_qa', color: '#0f766e', label: 'In QA' },
  { key: 'in_review', color: '#7c3aed', label: 'In Review' },
  { key: 'in_progress', color: '#1d4ed8', label: 'In Progress' },
  { key: 'todo', color: '#334155', label: 'To Do' },
];

interface Props {
  data: CFDPoint[];
}

export function CFDChart({ data }: Props) {
  const sampled = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 30)) === 0);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Cumulative Flow Diagram</h3>
      <p className="text-xs text-slate-600 mb-4">Acumulado por columna</p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={sampled}>
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 10, fill: '#475569' }} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            labelFormatter={formatDate}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
          {AREAS.map(a => (
            <Area
              key={a.key}
              type="monotone"
              dataKey={a.key}
              stackId="1"
              stroke={a.color}
              fill={a.color}
              fillOpacity={0.85}
              name={a.label}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
