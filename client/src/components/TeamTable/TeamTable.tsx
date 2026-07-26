import { useMemo, useState } from 'react';
import type { TeamScorecardResponse, ScorecardDimensions, DimensionContext } from '../../lib/api';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import { DimensionCell } from './DimensionCell';

type CtxMap = {
  delivery: DimensionContext; predictability: DimensionContext;
  focus: DimensionContext; flow: DimensionContext;
  regressions: DimensionContext; blocked: DimensionContext;
};

function generateInsight(p: ScorecardDimensions, ctx: CtxMap): string {
  const parts: string[] = [];

  if (p.delivery.value !== null) {
    const vs = p.delivery.value >= ctx.delivery.median * 1.2 ? 'alta'
             : p.delivery.value <= ctx.delivery.median * 0.8 ? 'baja'
             : 'en línea con el equipo';
    const trend = p.delivery.improving === 'better' ? ', mejorando'
                : p.delivery.improving === 'worse'  ? ', en baja' : '';
    parts.push(`Entrega ${vs}${trend}`);
  }

  if (p.predictability.value !== null) {
    const label = p.predictability.value <= 1.5 ? 'predecible'
                : p.predictability.value <= 2.5  ? 'algo variable'
                : 'muy variable';
    const trend = p.predictability.improving === 'better' ? ', mejorando'
                : p.predictability.improving === 'worse'  ? ', empeorando' : '';
    parts.push(`Cycle time ${label}${trend}`);
  }

  if (p.focus.value !== null) {
    const label = p.focus.value <= 1.5 ? 'muy enfocado/a'
                : p.focus.value <= 3   ? 'foco aceptable'
                : 'WIP elevado';
    const trend = p.focus.improving === 'better' ? ', mejorando'
                : p.focus.improving === 'worse'  ? ', empeorando' : '';
    parts.push(`${label}${trend}`);
  }

  if (p.flow.value !== null) {
    const label = p.flow.value >= 80 ? 'flujo muy eficiente'
                : p.flow.value >= 60  ? 'flujo aceptable'
                : 'flujo bajo';
    const trend = p.flow.improving === 'better' ? ', mejorando'
                : p.flow.improving === 'worse'  ? ', cayendo' : '';
    parts.push(`${label}${trend}`);
  }

  if (p.regressions.value !== null && p.regressions.value > 0) {
    const pct = Math.round(p.regressions.value);
    const trend = p.regressions.improving === 'better' ? ', mejorando'
                : p.regressions.improving === 'worse'  ? ', empeorando' : '';
    parts.push(`${pct}% de issues con regresiones${trend}`);
  }

  if (p.blocked.value !== null && p.blocked.value > 0) {
    const pct = Math.round(p.blocked.value);
    const trend = p.blocked.improving === 'better' ? ', mejorando'
                : p.blocked.improving === 'worse'  ? ', empeorando' : '';
    parts.push(`${pct}% de issues bloqueados${trend}`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : 'Sin datos suficientes para el período.';
}

function generateTasks(p: ScorecardDimensions, ctx: CtxMap): string[] {
  const tasks: string[] = [];
  if (p.delivery.improving === 'worse')
    tasks.push('Throughput bajando respecto al período anterior — revisar capacity o impedimentos');
  if (p.predictability.value !== null && p.predictability.value > 2.5)
    tasks.push(`Cycle time muy variable (ratio ${p.predictability.value.toFixed(1)}) — considerar dividir issues L/XL en partes más pequeñas`);
  else if (p.predictability.improving === 'worse')
    tasks.push('Predecibilidad empeorando — el spread del cycle time está aumentando');
  if (p.focus.value !== null && p.focus.value > 3)
    tasks.push(`WIP elevado: ${p.focus.value.toFixed(1)} issues en paralelo — cerrar antes de abrir nuevos`);
  if (p.regressions.value !== null && p.regressions.value > 15)
    tasks.push(`${Math.round(p.regressions.value)}% de issues retrocedieron — revisar criterios de Ready/Done`);
  if (p.blocked.value !== null && p.blocked.value > 20)
    tasks.push(`${Math.round(p.blocked.value)}% de issues se bloquearon — identificar dependencias y remover impedimentos`);
  return tasks;
}

type ColDef = { key: keyof ScorecardDimensions; label: string; format: (v: number) => string; info: string };

function PersonDetailPanel({ person, ctx, cols }: { person: ScorecardDimensions; ctx: CtxMap; cols: ColDef[] }) {
  const tasks = generateTasks(person, ctx);
  return (
    <div className="pt-3 pb-1 px-1">
      <div className="grid grid-cols-3 gap-2 mb-4">
        {cols.map(col => {
          const dim = person[col.key];
          const median = ctx[col.key].median;
          const arrow = dim.trend === 'up' ? '↑' : dim.trend === 'down' ? '↓' : '→';
          const color = dim.improving === 'better' ? 'text-green-400' : dim.improving === 'worse' ? 'text-red-400' : 'text-amber-400';
          return (
            <div key={col.key} className="bg-slate-900 rounded-lg p-3 border border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-1">{col.label}</div>
              <div className="flex items-baseline gap-1.5 mb-1">
                <span className="text-base font-bold text-slate-100">
                  {dim.value !== null ? col.format(dim.value) : '—'}
                </span>
                <span className={`text-sm font-bold ${color}`}>{arrow}</span>
              </div>
              <div className="text-[10px] text-slate-500 space-y-0.5">
                <div>equipo: {median != null ? col.format(median) : '—'}</div>
                {dim.previous !== null && <div>anterior: {col.format(dim.previous)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {tasks.length > 0 ? (
        <div>
          <div className="text-[9px] uppercase tracking-wide text-amber-600 font-semibold mb-1.5">⚠ Prestar atención</div>
          <ul className="space-y-1">
            {tasks.map((t, i) => (
              <li key={i} className="text-[11px] text-amber-300 flex gap-2">
                <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>{t}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-[11px] text-green-400">✓ Sin alertas para este período</div>
      )}
    </div>
  );
}

type SortKey = 'name' | keyof ScorecardDimensions;
type SortDir = 'asc' | 'desc';

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
  { key: 'regressions' as const, label: 'Regresiones', format: fmtPct,
    info: '% de issues completados que en algún momento retrocedieron a un estado anterior (p.ej. de In Progress a To Do). Más bajo es mejor.' },
  { key: 'blocked' as const, label: 'Bloqueados', format: fmtPct,
    info: '% de issues completados que pasaron por el estado "Blocked". Más bajo es mejor.' },
];

function Initials({ name }: { name: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-200 flex-shrink-0">
      {name.split(' ').map(n => n[0]).join('').slice(0, 2)}
    </div>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return <span aria-hidden className="text-slate-300">{dir === 'asc' ? '▲' : '▼'}</span>;
}

interface Props {
  scorecard: TeamScorecardResponse;
  loading: boolean;
}

export function TeamTable({ scorecard, loading }: Props) {
  const { team, members, context } = scorecard;
  // Default order is alphabetical (neutral, no ranking). Clicking a header sorts by it.
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  const sortedMembers = useMemo(() => {
    const arr = [...members];
    arr.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.member.display_name.localeCompare(b.member.display_name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = (a as ScorecardDimensions)[sortKey].value;
      const bv = (b as ScorecardDimensions)[sortKey].value;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;   // missing values always sort last
      if (bv === null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [members, sortKey, sortDir]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rendimiento por persona</h3>
        <InfoTooltip text="Cuatro señales de flujo por persona. La flecha compara con el período anterior (verde = mejora, ámbar = empeora). La barrita ubica a la persona contra la mediana del equipo (marca clara), como contexto, no como ranking." />
      </div>
      <p className="text-xs text-slate-600 mb-4">Entrega · Predecibilidad · Foco · Flujo — tendencia vs. período anterior · clic en un encabezado para ordenar</p>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-700 rounded animate-pulse" />)}
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2" aria-sort={ariaSort('name')}>
                <button
                  type="button"
                  onClick={() => toggleSort('name')}
                  className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-300"
                >
                  Persona<SortArrow active={sortKey === 'name'} dir={sortDir} />
                </button>
              </th>
              {COLUMNS.map(col => (
                <th key={col.key} className="text-left pb-2" aria-sort={ariaSort(col.key)}>
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-300"
                    >
                      {col.label}<SortArrow active={sortKey === col.key} dir={sortDir} />
                    </button>
                    <InfoTooltip text={col.info} />
                  </span>
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
            {sortedMembers.flatMap(p => {
              const expanded = expandedId === p.member.id;
              return [
                <tr
                  key={p.member.id}
                  className="border-t border-slate-700 hover:bg-slate-700/40 cursor-pointer select-none"
                  onClick={() => toggleExpand(p.member.id)}
                >
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <Initials name={p.member.display_name} />
                      <div className="text-slate-200 font-medium">{p.member.display_name}</div>
                      <InfoTooltip text={generateInsight(p, context)} />
                      <span className="text-slate-500 text-[10px] ml-auto pr-1">{expanded ? '▲' : '▼'}</span>
                    </div>
                  </td>
                  {COLUMNS.map(col => (
                    <DimensionCell key={col.key} dim={(p as ScorecardDimensions)[col.key]} context={context[col.key]} format={col.format} />
                  ))}
                </tr>,
                expanded && (
                  <tr key={`${p.member.id}-detail`} className="border-t border-slate-700 bg-slate-800/60">
                    <td colSpan={COLUMNS.length + 1} className="px-3 pb-3">
                      <PersonDetailPanel person={p as ScorecardDimensions} ctx={context as CtxMap} cols={COLUMNS} />
                    </td>
                  </tr>
                ),
              ].filter(Boolean);
            })}
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
