import type { ComparisonResult, ComparisonPeriod } from '../../lib/api';

interface Props {
  result: ComparisonResult | null;
  loading: boolean;
  week: string | undefined;
  setWeek: (w: string) => void;
}

function getRecentMondays(n: number): string[] {
  const mondays: string[] = [];
  const today = new Date();
  const diff = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - diff);
  thisMonday.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const mon = new Date(thisMonday);
    mon.setDate(thisMonday.getDate() - i * 7);
    mondays.push(mon.toISOString().slice(0, 10));
  }
  return mondays;
}

function formatWeekLabel(mondayStr: string): string {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  const sun = new Date(y, m - 1, d + 6);
  const fmt = (date: Date) => date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function deltaColor(delta: number, metric: 'throughput' | 'wip'): string {
  if (delta === 0) return 'text-slate-500';
  if (metric === 'throughput') return delta > 0 ? 'text-green-400' : 'text-red-400';
  return delta > 0 ? 'text-amber-400' : 'text-green-400';
}

function arrow(delta: number): string {
  return delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
}

function insight(r: ComparisonResult): string {
  const tUp = r.throughput.delta > 0, tDown = r.throughput.delta < 0;
  const wUp = r.wip.delta > 0, wDown = r.wip.delta < 0;
  if (tUp && wDown) return 'Buena semana: más entregas y menos trabajo en curso.';
  if (tUp && wUp)   return 'El throughput subió pero el WIP también — la velocidad de entrega no absorbió todo el trabajo nuevo.';
  if (tDown && wUp) return 'Semana difícil: menos entregas y más trabajo acumulado.';
  if (tDown && wDown) return 'Menos entregas, pero el WIP bajó — puede ser una semana de enfoque o depuración.';
  return 'Sin cambios significativos respecto a la semana anterior.';
}

function MetricBlock({ label, p, metric }: { label: string; p: ComparisonPeriod; metric: 'throughput' | 'wip' }) {
  const col = deltaColor(p.delta, metric);
  return (
    <div className="bg-slate-900/60 rounded-lg p-4">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-slate-100 leading-none">{p.current}</span>
        <span className={`text-sm font-semibold ${col}`}>
          {arrow(p.delta)} {p.delta > 0 ? '+' : ''}{p.delta}
          {p.deltaPct !== null && (
            <span className="text-[10px] font-normal ml-0.5">({p.delta > 0 ? '+' : ''}{p.deltaPct}%)</span>
          )}
        </span>
        <span className="text-2xl font-bold text-slate-600 leading-none ml-auto">{p.previous}</span>
      </div>
    </div>
  );
}

export function ComparisonCard({ result, loading, week, setWeek }: Props) {
  const mondays = getRecentMondays(12);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Comparativa semanal</h3>
        <select
          value={week ?? ''}
          onChange={e => setWeek(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        >
          {week === undefined && <option value="">Semana actual</option>}
          {mondays.map(m => (
            <option key={m} value={m}>{formatWeekLabel(m)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 bg-slate-700/40 rounded-lg animate-pulse" />
          <div className="h-24 bg-slate-700/40 rounded-lg animate-pulse" />
        </div>
      ) : !result ? (
        <div className="h-24 flex items-center justify-center text-slate-500 text-sm">
          Sin datos para la semana seleccionada.
        </div>
      ) : (
        <>
          <div className="flex items-center -mx-4 border-y border-slate-700 mb-3">
            <div className="flex-1 px-4 py-2 bg-blue-900/10">
              <div className="text-[9px] uppercase tracking-wide text-blue-400 mb-0.5">Esta semana</div>
              <div className="text-[13px] font-semibold text-slate-200">{formatWeekLabel(result.week)}</div>
            </div>
            <div className="px-3 text-slate-600 text-lg font-light">vs</div>
            <div className="flex-1 px-4 py-2">
              <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-0.5">Semana anterior</div>
              <div className="text-[13px] font-semibold text-slate-400">{formatWeekLabel(result.prevWeek)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <MetricBlock label="Throughput" p={result.throughput} metric="throughput" />
            <MetricBlock label="WIP al cierre" p={result.wip} metric="wip" />
          </div>
          <p className="text-[11px] text-slate-500">{insight(result)}</p>
        </>
      )}
    </div>
  );
}
