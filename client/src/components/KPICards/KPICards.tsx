import type { KPIMetrics } from '../../lib/api';
import { formatDays } from '../../lib/formatters';
import { InfoTooltip } from '../InfoTooltip/InfoTooltip';

interface Props {
  kpis: KPIMetrics | null;
  loading: boolean;
}

function KPICard({ label, info, value, meta, valueClass }: { label: string; info: string; value: string; meta: string; valueClass: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-slate-500 mb-2">
        {label}
        <InfoTooltip text={info} />
      </div>
      <div className={`text-3xl font-bold leading-none ${valueClass}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1.5">{meta}</div>
    </div>
  );
}

export function KPICards({ kpis, loading }: Props) {
  if (loading || !kpis) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      <KPICard
        label="WIP Actual"
        info="Cantidad de issues que están activos en el board ahora mismo: no están en To Do ni en Done/Cancelado."
        value={String(kpis.wip)}
        meta="issues en el board"
        valueClass="text-blue-400"
      />
      <KPICard
        label="Throughput"
        info="Cantidad de issues que pasaron a Done dentro del rango de fechas filtrado."
        value={String(kpis.throughput)}
        meta="issues cerrados en el período"
        valueClass="text-emerald-400"
      />
      <KPICard
        label="Cycle Time p50 / p85"
        info="Días entre que un issue entra a In Progress y llega a Done. p50 = mediana (caso típico). p85 = el 85% de los issues se resuelve en este tiempo o menos; útil para comprometer plazos."
        value={formatDays(kpis.cycle_time_p50)}
        meta={`p85 = ${formatDays(kpis.cycle_time_p85)}`}
        valueClass="text-violet-400"
      />
      <KPICard
        label="Issues bloqueados"
        info="Issues activos (no Done/Cancelado) que no tuvieron ningún cambio de estado en más de AGING_THRESHOLD_DAYS (7 días por defecto)."
        value={String(kpis.blocked_count)}
        meta={kpis.blocked_count > 0 ? '⚠ sin moverse > 7 días' : 'sin bloqueos'}
        valueClass={kpis.blocked_count > 0 ? 'text-red-400' : 'text-slate-400'}
      />
    </div>
  );
}
