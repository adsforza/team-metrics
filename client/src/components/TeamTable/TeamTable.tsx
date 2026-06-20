import type { PersonMetrics } from '../../lib/api';
import { formatDays, TALLA_COLOR, SCORE_BG } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];

function TallaMix({ mix }: { mix: Record<Talla, number> }) {
  const total = TALLAS.reduce((s, t) => s + mix[t], 0);
  if (total === 0) return <span className="text-slate-600 text-xs">Sin datos</span>;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 rounded overflow-hidden gap-px">
        {TALLAS.map(t =>
          mix[t] > 0 && (
            <div key={t} style={{ width: `${(mix[t] / total) * 100}%`, background: TALLA_COLOR[t] }} />
          )
        )}
      </div>
      <div className="text-[10px] text-slate-500">
        {TALLAS.filter(t => mix[t] > 0)
          .map(t => `${mix[t]}${t}`)
          .join(' · ')}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-5">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 bg-blue-500 opacity-70 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
        />
      ))}
    </div>
  );
}

interface Props {
  team: PersonMetrics[];
  loading: boolean;
}

export function TeamTable({ team, loading }: Props) {
  const maxThroughput = Math.max(...team.map(p => p.throughput), 1);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rendimiento por persona</h3>
        <InfoTooltip text="Score A/B/C/D por cuartil: se ordena a cada persona por throughput ponderado por talla (S=1, M=2, L=4, XL=8) dividido por su cycle time p50, y se reparte en cuartiles. A = cuartil superior del equipo, D = inferior. Compara dentro del equipo, no contra un estándar absoluto." />
        <span className="text-xs text-purple-400 bg-purple-950 border border-purple-800 px-2 py-0.5 rounded-full">✦ normalizado por complejidad</span>
      </div>
      <p className="text-xs text-slate-600 mb-4">Throughput · Cycle time p50 · Mix de tallas · Score ajustado</p>
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="text-left pb-2">
                <span className="inline-flex items-center gap-1">
                  Persona
                  <InfoTooltip text="Miembro del equipo, según el assignee de Jira." />
                </span>
              </th>
              <th className="text-left pb-2">
                <span className="inline-flex items-center gap-1">
                  Throughput
                  <InfoTooltip text="Cantidad de issues que esa persona llevó a Done dentro del rango de fechas filtrado." />
                </span>
              </th>
              <th className="text-left pb-2">
                <span className="inline-flex items-center gap-1">
                  CT p50
                  <InfoTooltip text="Cycle time mediano (p50) de los issues Done de esa persona: días entre que el issue entra a In Progress y llega a Done." />
                </span>
              </th>
              <th className="text-left pb-2 min-w-[120px]">
                <span className="inline-flex items-center gap-1">
                  Mix de tallas
                  <InfoTooltip text="Distribución S/M/L/XL de los issues Done de esa persona, según la talla que clasificó la IA." />
                </span>
              </th>
              <th className="text-center pb-2">
                <span className="inline-flex items-center gap-1">
                  Bloq.
                  <InfoTooltip text="Issues activos de esa persona sin ningún cambio de estado hace más de AGING_THRESHOLD_DAYS (7 días por defecto)." />
                </span>
              </th>
              <th className="text-center pb-2">
                <span className="inline-flex items-center gap-1">
                  Score
                  <InfoTooltip text="Cuartil A/B/C/D: throughput ponderado por talla (S=1, M=2, L=4, XL=8) dividido por cycle time p50, comparado contra el resto del equipo. A = cuartil superior, D = inferior." />
                </span>
              </th>
              <th className="text-center pb-2">
                <span className="inline-flex items-center gap-1">
                  4 sem.
                  <InfoTooltip text="Throughput semanal de esa persona en las últimas 4 semanas, de la más vieja a la más reciente, para ver si está acelerando o frenando." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {team.map(p => (
              <tr key={p.member.id} className="border-t border-slate-700 hover:bg-slate-700/40">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center text-[10px] font-bold text-blue-200 flex-shrink-0">
                      {p.member.display_name
                        .split(' ')
                        .map((n: string) => n[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                    <div className="text-slate-200 font-medium">{p.member.display_name}</div>
                  </div>
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 rounded" style={{ width: `${(p.throughput / maxThroughput) * 100}%` }} />
                    </div>
                    <span className="text-slate-400 w-5 text-right">{p.throughput}</span>
                  </div>
                </td>
                <td className="py-2.5 text-violet-400 font-semibold">{formatDays(p.ct_p50)}</td>
                <td className="py-2.5">
                  <TallaMix mix={p.mix_tallas} />
                </td>
                <td className="py-2.5 text-center">
                  <span className={p.blocked > 0 ? (p.blocked >= 2 ? 'text-red-400' : 'text-amber-400') : 'text-slate-600'}>
                    {p.blocked}
                  </span>
                </td>
                <td className="py-2.5 text-center">
                  <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-xs font-black ${SCORE_BG[p.score]}`}>
                    {p.score}
                  </span>
                </td>
                <td className="py-2.5">
                  <div className="flex justify-center pt-1">
                    <Sparkline values={p.sparkline} />
                  </div>
                </td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-slate-600">
                  Sin datos de equipo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
