// client/src/components/TeamTable/DimensionCell.tsx
import type { DimensionValue, DimensionContext } from '../../lib/api';

const ARROW: Record<DimensionValue['trend'], string> = { up: '▲', down: '▼', flat: '=' };
const IMPROVING_CLASS: Record<DimensionValue['improving'], string> = {
  better: 'text-green-400',
  worse: 'text-amber-400',
  steady: 'text-slate-500',
};
const IMPROVING_LABEL: Record<DimensionValue['improving'], string> = {
  better: 'mejora',
  worse: 'empeora',
  steady: 'estable',
};

interface Props {
  dim: DimensionValue;
  context: DimensionContext;
  format: (value: number) => string;
}

export function DimensionCell({ dim, context, format }: Props) {
  if (dim.value === null) {
    return <td className="py-2.5 text-slate-600">—</td>;
  }

  // Position the value and the median marker on a 0..100% scale of [min,max].
  const span = context.max - context.min;
  const pct = (v: number) => (span === 0 ? 50 : ((v - context.min) / span) * 100);
  const fillPct = pct(dim.value);
  const medianPct = pct(context.median);

  return (
    <td className="py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-200 font-semibold tabular-nums">{format(dim.value)}</span>
        <span className={IMPROVING_CLASS[dim.improving]} aria-label={IMPROVING_LABEL[dim.improving]}>
          {ARROW[dim.trend]}
        </span>
      </div>
      <div className="relative h-1.5 w-14 bg-slate-700 rounded mt-1">
        <div className="absolute top-0 left-0 h-full bg-blue-500/60 rounded" style={{ width: `${fillPct}%` }} />
        <div className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-300 rounded" style={{ left: `${medianPct}%` }} />
      </div>
    </td>
  );
}
