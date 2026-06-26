import type { ForecastResult } from '../../lib/api';
import type { ForecastMode } from '../../hooks/useForecast';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';
import { ForecastHistogram } from './ForecastHistogram';

interface Props {
  forecast: ForecastResult | null;
  loading: boolean;
  mode: ForecastMode;
  setMode: (m: ForecastMode) => void;
  items: number | undefined;
  setItems: (n: number) => void;
  horizon: number;
  setHorizon: (n: number) => void;
}

function Toggle({ mode, setMode }: { mode: ForecastMode; setMode: (m: ForecastMode) => void }) {
  const btn = (m: ForecastMode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`px-3 py-1 rounded-md ${mode === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
    >
      {label}
    </button>
  );
  return <div className="inline-flex gap-1 text-xs">{btn('when', '¿Cuándo?')}{btn('howMany', '¿Cuántos?')}</div>;
}

function ConfBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function ForecastCard(props: Props) {
  const { forecast, loading, mode, setMode, items, setItems, horizon, setHorizon } = props;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Forecast · Monte Carlo</h3>
          <InfoTooltip text="Simulación de 10.000 escenarios a partir del throughput diario de las últimas 12 semanas. ¿Cuándo?: días/fecha para completar N issues. ¿Cuántos?: issues completados en D días. Más confianza = fecha más tardía (¿cuándo?) o menos items (¿cuántos?)." />
        </div>
        <Toggle mode={mode} setMode={setMode} />
      </div>

      <div className="flex items-center gap-2 mb-4 text-xs text-slate-400">
        {mode === 'when' ? (
          <label className="flex items-center gap-2">Items a completar
            <input type="number" min={1} max={1000} value={items ?? ''}
              onChange={e => setItems(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200" />
          </label>
        ) : (
          <label className="flex items-center gap-2">Horizonte (días)
            <input type="number" min={1} max={365} value={horizon}
              onChange={e => setHorizon(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200" />
          </label>
        )}
      </div>

      {loading || !forecast ? (
        <div className="h-40 bg-slate-700/40 rounded animate-pulse" />
      ) : forecast.insufficientData ? (
        <div className="h-40 flex items-center justify-center text-center text-slate-500 text-sm px-6">
          Sin suficiente histórico para pronosticar (se necesitan entregas en las últimas 12 semanas).
        </div>
      ) : mode === 'when' && forecast.when ? (
        <>
          <div className="flex gap-2 mb-3">
            <ConfBlock label="50%" value={forecast.when.conf50.date} sub={`${forecast.when.conf50.days} días`} />
            <ConfBlock label="85%" value={forecast.when.conf85.date} sub={`${forecast.when.conf85.days} días`} />
            <ConfBlock label="95%" value={forecast.when.conf95.date} sub={`${forecast.when.conf95.days} días`} />
          </div>
          <p className="text-[11px] text-slate-600 mb-1">Más confianza = fecha más tardía (más segura).</p>
          <ForecastHistogram bins={forecast.when.histogram}
            marks={[{ x: forecast.when.conf50.days, label: 'P50' }, { x: forecast.when.conf85.days, label: 'P85' }, { x: forecast.when.conf95.days, label: 'P95' }]}
            unit="días" />
        </>
      ) : mode === 'howMany' && forecast.howMany ? (
        <>
          <div className="flex gap-2 mb-3">
            <ConfBlock label="50%" value={`≥ ${forecast.howMany.conf50}`} sub="issues" />
            <ConfBlock label="85%" value={`≥ ${forecast.howMany.conf85}`} sub="issues" />
            <ConfBlock label="95%" value={`≥ ${forecast.howMany.conf95}`} sub="issues" />
          </div>
          <p className="text-[11px] text-slate-600 mb-1">Más confianza = menos items (más seguro).</p>
          <ForecastHistogram bins={forecast.howMany.histogram}
            marks={[{ x: forecast.howMany.conf50, label: 'P50' }, { x: forecast.howMany.conf85, label: 'P85' }, { x: forecast.howMany.conf95, label: 'P95' }]}
            unit="issues" />
        </>
      ) : null}
    </div>
  );
}
