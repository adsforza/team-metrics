import type { WipRiskResult, WipRiskItem } from '../../lib/api';
import type { Talla } from '../../../../server/src/types';
import { TALLA_BG } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

interface Props {
  result: WipRiskResult | null;
  loading: boolean;
}

function RatioBar({ item }: { item: WipRiskItem }) {
  const color = item.level === 'excedido' ? 'bg-red-500' : 'bg-amber-500';
  const pct = Math.min(item.ratio, 1.5) / 1.5 * 100;
  const limitPct = 1 / 1.5 * 100;
  return (
    <div className="relative h-1.5 w-16 bg-slate-700 rounded">
      <div className={`absolute top-0 left-0 h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      <div className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-300 rounded" style={{ left: `${limitPct}%` }} />
    </div>
  );
}

export function WipRiskCard({ result, loading }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">WIP en riesgo</h3>
        <InfoTooltip text="Issues en curso cuya edad (desde que entraron a un estado activo) se acerca o supera el cycle time esperado de su talla (p85 de las últimas 12 semanas). ⚠ en riesgo ≥ 70% del límite; ● excedido ≥ 100%." />
      </div>

      {loading || !result ? (
        <div className="mt-3 h-40 bg-slate-700/40 rounded animate-pulse" />
      ) : (
        <>
          <p className="text-xs mb-4 flex gap-3">
            <span className="text-amber-400">⚠ {result.counts.en_riesgo} en riesgo</span>
            <span className="text-red-400">● {result.counts.excedido} excedido{result.counts.excedido === 1 ? '' : 's'}</span>
            {result.counts.sin_limite > 0 && <span className="text-slate-600">· {result.counts.sin_limite} sin límite</span>}
          </p>

          {result.items.length === 0 ? (
            <div className="py-6 text-center text-slate-500 text-sm">Nada en riesgo para su talla 🎉</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
                  <th className="text-left pb-2">Issue</th>
                  <th className="text-left pb-2">Título</th>
                  <th className="text-left pb-2">Talla</th>
                  <th className="text-right pb-2">Edad</th>
                  <th className="text-right pb-2">Límite</th>
                  <th className="text-right pb-2">Nivel</th>
                </tr>
              </thead>
              <tbody>
                {result.items.slice(0, 8).map(item => (
                  <tr key={item.issue_id} className="border-t border-slate-700 hover:bg-slate-700/40">
                    <td className="py-2 font-mono text-blue-400 font-semibold">{item.issue_id}</td>
                    <td className="py-2 text-slate-300 max-w-[140px] truncate pr-2">{item.title}</td>
                    <td className="py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${TALLA_BG[item.talla as Talla]}`}>{item.talla}</span>
                    </td>
                    <td className="py-2 text-right text-slate-300">{item.age_days.toFixed(1)}d</td>
                    <td className="py-2 text-right text-slate-500">{item.limit_days.toFixed(1)}d</td>
                    <td className="py-2">
                      <div className="flex justify-end">
                        <RatioBar item={item} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
