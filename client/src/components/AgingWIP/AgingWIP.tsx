import type { AgingIssue } from '../../lib/api';
import { agePillClass, TALLA_BG } from '../../lib/formatters';
import type { Talla } from '../../../../server/src/types';

interface Props {
  issues: AgingIssue[];
}

export function AgingWIP({ issues }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Aging WIP</h3>
      <p className="text-xs text-slate-600 mb-4">Issues sin movimiento · ordenados por días</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 uppercase tracking-wide text-[10px]">
            <th className="text-left pb-2">Issue</th>
            <th className="text-left pb-2">Título</th>
            <th className="text-left pb-2">Talla</th>
            <th className="text-left pb-2">Estado</th>
            <th className="text-right pb-2">Días</th>
          </tr>
        </thead>
        <tbody>
          {issues.slice(0, 8).map(issue => (
            <tr key={issue.issue_id} className="border-t border-slate-700 hover:bg-slate-700/40">
              <td className="py-2 font-mono text-blue-400 font-semibold">{issue.issue_id}</td>
              <td className="py-2 text-slate-300 max-w-[160px] truncate pr-2">{issue.title}</td>
              <td className="py-2">
                {issue.talla ? (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${TALLA_BG[issue.talla as Talla]}`}>
                    {issue.talla}
                  </span>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="py-2">
                <span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-[10px]">{issue.status}</span>
              </td>
              <td className="py-2 text-right">
                <span className={`inline-block px-2 py-0.5 rounded-full font-bold ${agePillClass(issue.days_in_status)}`}>
                  {issue.days_in_status}d
                </span>
              </td>
            </tr>
          ))}
          {issues.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-slate-600">
                Sin issues activos
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
