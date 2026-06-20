import { useState } from 'react';

interface Props {
  text: string;
}

/**
 * Icono "i" que muestra una explicación al pasar el mouse o el foco por encima.
 * Pensado para ir al lado de títulos de cards/gráficos.
 */
export function InfoTooltip({ text }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="w-3.5 h-3.5 rounded-full border border-slate-600 text-slate-500 hover:text-slate-300 hover:border-slate-400 flex items-center justify-center text-[9px] font-bold leading-none cursor-help normal-case"
        aria-label="Información"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] leading-snug text-slate-300 shadow-lg normal-case font-normal tracking-normal"
        >
          {text}
        </span>
      )}
    </span>
  );
}
