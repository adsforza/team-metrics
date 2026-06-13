import { useFilters } from '../../store/filters';
import type { Talla } from '../../../../server/src/types';

const TALLAS: Talla[] = ['S', 'M', 'L', 'XL'];

export function TallaFilter() {
  const { talla, setTalla } = useFilters();
  return (
    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">
      <span className="text-slate-400 text-xs">★</span>
      <select
        value={talla}
        onChange={e => setTalla(e.target.value)}
        className="bg-transparent text-slate-200 text-xs outline-none cursor-pointer"
      >
        <option value="">Todas las tallas</option>
        {TALLAS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
