import { Fragment, useState } from 'react';
import type { BottleneckResult, BottleneckState, BottleneckTopIssue, BottleneckTallaBreakdown, BottleneckWeekPoint, BottleneckScore } from '../../lib/api';
import type { Talla } from '../../../../server/src/types';
import { TALLA_BG } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

const SCORE_CLASS: Record<BottleneckScore, string> = {
  crítico: 'text-red-400',
  alto:    'text-amber-400',
  medio:   'text-yellow-400',
  normal:  'text-slate-400',
};

function ScoreBadge({ score }: { score: BottleneckScore }) {
  return <span className={`font-medium ${SCORE_CLASS[score]}`}>● {score}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-200">{value}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function TrendChart({ trend, p85_days }: { trend: BottleneckWeekPoint[]; p85_days: number | null }) {
  if (trend.length === 0) return <p className="text-slate-600 text-[11px]">Sin datos históricos</p>;
  const maxAvg = Math.max(...trend.map(w => w.avg_days), 0.001);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 80 }}>
      {trend.map(w => {
        const heightPct = (w.avg_days / maxAvg) * 100;
        const isHigh = p85_days !== null && w.avg_days >= p85_days;
        const isMid  = p85_days !== null && w.avg_days >= p85_days * 0.7;
        const barColor = isHigh ? 'bg-red-500' : isMid ? 'bg-amber-500' : 'bg-blue-500/70';
        const label = new Date(w.week).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        return (
          <div key={w.week} className="flex flex-col items-center gap-0.5 flex-1 h-full justify-end">
            <span className="text-[8px] text-slate-500 leading-none">{w.avg_days.toFixed(1)}d</span>
            <div className={`w-full rounded-t ${barColor}`} style={{ height: `${heightPct}%` }} />
            <span className="text-[7px] text-slate-600" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: 28, lineHeight: 1 }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ByTalla({ by_talla }: { by_talla: BottleneckTallaBreakdown[] }) {
  if (by_talla.length === 0) return null;
  const maxAvg = Math.max(...by_talla.map(b => b.avg_days), 0.001);
  return (
    <div className="space-y-1.5">
      {by_talla.map(bt => (
        <div key={bt.talla} className="flex items-center gap-2">
          <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-black w-6 text-center ${TALLA_BG[bt.talla as Talla]}`}>
            {bt.talla}
          </span>
          <div className="flex-1 h-1.5 bg-slate-700 rounded overflow-hidden">
            <div className="h-full bg-blue-400/70 rounded" style={{ width: `${(bt.avg_days / maxAvg) * 100}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 w-10 text-right">{bt.avg_days.toFixed(1)}d</span>
        </div>
      ))}
    </div>
  );
}

function TopIssuesTable({
  top_issues,
  queue_size,
  p85_days,
}: {
  top_issues: BottleneckTopIssue[];
  queue_size: number;
  p85_days: number | null;
}) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-slate-500 text-[10px]">
          <th className="text-left pb-1 pr-2">Issue</th>
          <th className="text-left pb-1 pr-2">Título</th>
          <th className="text-left pb-1 pr-2">Talla</th>
          <th className="text-right pb-1">Días</th>
        </tr>
      </thead>
      <tbody>
        {top_issues.map(iss => {
          const daysClass =
            p85_days !== null
              ? iss.days_in_state >= p85_days
                ? 'text-red-400 font-bold'
                : iss.days_in_state >= p85_days * 0.7
                ? 'text-amber-400'
                : 'text-slate-300'
              : 'text-slate-300';
          return (
            <tr key={iss.issue_id} className="border-t border-slate-800">
              <td className="py-1 text-blue-400 font-mono pr-2">{iss.issue_id}</td>
              <td className="py-1 text-slate-400 truncate max-w-[110px] pr-2">{iss.title}</td>
              <td className="py-1 pr-2">
                {iss.talla && (
                  <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-black ${TALLA_BG[iss.talla as Talla]}`}>
                    {iss.talla}
                  </span>
                )}
              </td>
              <td className={`py-1 text-right ${daysClass}`}>{iss.days_in_state.toFixed(1)}d</td>
            </tr>
          );
        })}
        {queue_size > top_issues.length && (
          <tr className="border-t border-slate-800">
            <td colSpan={4} className="py-1 text-center text-slate-600 text-[10px] italic">
              + {queue_size - top_issues.length} issues más
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function DetailPanel({ state }: { state: BottleneckState }) {
  const { queue_size, avg_days, detail } = state;
  const { p85_days, pct_of_wip, trend_pct, trend, top_issues, by_talla } = detail;

  const trendLabel =
    trend_pct !== null
      ? `${trend_pct > 0 ? '↑' : '↓'}${Math.abs(trend_pct).toFixed(0)}%`
      : '—';

  return (
    <div className="p-4 bg-slate-900 space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Issues ahora" value={String(queue_size)} />
        <Kpi
          label="Tiempo medio"
          value={avg_days !== null ? `${avg_days.toFixed(1)}d` : '—'}
          sub={p85_days !== null ? `p85: ${p85_days.toFixed(1)}d` : undefined}
        />
        <Kpi label="% del WIP" value={`${(pct_of_wip * 100).toFixed(0)}%`} />
        <Kpi label="Tendencia 8 sem" value={trendLabel} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
            Issues con más tiempo aquí
          </p>
          <TopIssuesTable top_issues={top_issues} queue_size={queue_size} p85_days={p85_days} />
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
              Tiempo medio — últimas 8 semanas
            </p>
            <TrendChart trend={trend} p85_days={p85_days} />
          </div>
          {by_talla.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-2">
                Tiempo medio por talla
              </p>
              <ByTalla by_talla={by_talla} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  result: BottleneckResult | null;
  loading: boolean;
}

export function BottleneckCard({ result, loading }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (status: string) => setSelected(prev => (prev === status ? null : status));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Cuellos de Botella
        </h3>
        <InfoTooltip text="Estados del flujo con mayor acumulación de issues y/o tiempo de espera. Score: 0.5×cola_normalizada + 0.5×tiempo_normalizado, por quartil (crítico/alto/medio/normal). Lookback: 8 semanas." />
      </div>

      {loading || !result ? (
        <div className="h-32 bg-slate-700/40 rounded animate-pulse" />
      ) : result.states.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-6">Sin datos de estados activos</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">Estado</th>
              <th className="text-right pb-2">Cola</th>
              <th className="text-right pb-2">Tiempo medio</th>
              <th className="text-right pb-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {result.states.map(state => (
              <Fragment key={state.status}>
                <tr
                  className="border-t border-slate-700 hover:bg-slate-700/40 cursor-pointer"
                  onClick={() => toggle(state.status)}
                >
                  <td className="py-2 text-slate-200">{state.status}</td>
                  <td className="py-2 text-right text-slate-300">{state.queue_size}</td>
                  <td className="py-2 text-right text-slate-300">
                    {state.avg_days !== null ? `${state.avg_days.toFixed(1)}d` : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <ScoreBadge score={state.score} />
                  </td>
                </tr>
                {selected === state.status && (
                  <tr className="border-t border-slate-700">
                    <td colSpan={4} className="p-0">
                      <DetailPanel state={state} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
