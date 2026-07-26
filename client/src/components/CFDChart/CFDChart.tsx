import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { CFDPoint } from '../../lib/api';
import { formatDate } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

const ALL_AREAS = [
  { key: 'done',        color: '#166534', label: 'Done'       },
  { key: 'in_qa',      color: '#0f766e', label: 'Blocked'    },
  { key: 'in_review',  color: '#7c3aed', label: 'Ready'      },
  { key: 'in_progress',color: '#1d4ed8', label: 'In Progress' },
  { key: 'todo',       color: '#334155', label: 'To Do'       },
];

interface Props {
  data: CFDPoint[];
}

export function CFDChart({ data }: Props) {
  const [showDone, setShowDone] = useState(false);
  const areas = showDone ? ALL_AREAS : ALL_AREAS.filter(a => a.key !== 'done');

  const sampled = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 30)) === 0);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cumulative Flow Diagram</h3>
          <InfoTooltip text="Cantidad acumulada de issues en cada estado del board, día por día. Una banda que se ensancha indica que ese estado está acumulando issues más rápido de lo que se vacía (cuello de botella)." />
        </div>
        <button
          onClick={() => setShowDone(v => !v)}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            showDone
              ? 'border-green-700 text-green-400 bg-green-900/30'
              : 'border-slate-600 text-slate-500 hover:text-slate-300'
          }`}
        >
          {showDone ? '✓ Done visible' : 'Mostrar Done'}
        </button>
      </div>
      <p className="text-xs text-slate-600 mb-4">Acumulado por columna</p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={sampled}>
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <Tooltip
            contentStyle={{ background: '#1e2535', border: '1px solid #2d3748', borderRadius: 8, fontSize: 11 }}
            labelFormatter={formatDate}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
          {areas.map(a => (
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
