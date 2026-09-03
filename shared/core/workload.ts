import { categorize } from './statusCategories';
import type { CoreIssueWorkload } from './types';

export interface WorkloadRequester { requester: string | null; pedidos: number; pendientes: number; }
export interface WorkloadSquad {
  board_id: number; name: string;
  pedidos: number; pendientes: number;
  requesters: WorkloadRequester[];
}
export interface WorkloadResult {
  squads: WorkloadSquad[];
  totals: { pedidos: number; pendientes: number; compartidos: number };
}

// Pendiente = todo lo que no esta terminado ni cancelado. Deliberadamente NO se
// filtra por rango: un ticket abierto hace ocho meses sigue pesando hoy.
export function isPendiente(status: string): boolean {
  const c = categorize(status);
  return c !== 'done' && c !== 'cancelled';
}

function enRango(created_at: string, from?: string, to?: string): boolean {
  const d = created_at.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function computeWorkload(
  issues: CoreIssueWorkload[],
  boards: { id: number; name: string }[],
  params: { from?: string; to?: string },
): WorkloadResult {
  const known = new Set(boards.map(b => b.id));
  const acc = new Map<number, Map<string | null, WorkloadRequester>>();
  for (const b of boards) acc.set(b.id, new Map());

  let totalPedidos = 0, totalPendientes = 0, compartidos = 0;

  for (const issue of issues) {
    const mine = issue.boards.filter(b => known.has(b));
    if (mine.length === 0) continue;
    if (mine.length > 1) compartidos++;

    const esPedido = enRango(issue.created_at, params.from, params.to);
    const esPend = isPendiente(issue.status);
    if (!esPedido && !esPend) continue;

    if (esPedido) totalPedidos++;
    if (esPend) totalPendientes++;

    for (const boardId of mine) {
      const bucket = acc.get(boardId)!;
      // Map admite null como clave, asi que el bucket "sin dato" no necesita
      // un centinela de string que podria colisionar con un equipo real.
      let row = bucket.get(issue.requester);
      if (!row) {
        row = { requester: issue.requester, pedidos: 0, pendientes: 0 };
        bucket.set(issue.requester, row);
      }
      if (esPedido) row.pedidos++;
      if (esPend) row.pendientes++;
    }
  }

  const squads: WorkloadSquad[] = boards.map(b => {
    const rows = [...acc.get(b.id)!.values()].sort((x, y) =>
      y.pedidos - x.pedidos || (x.requester ?? '').localeCompare(y.requester ?? ''));
    return {
      board_id: b.id, name: b.name,
      pedidos: rows.reduce((s, r) => s + r.pedidos, 0),
      pendientes: rows.reduce((s, r) => s + r.pendientes, 0),
      requesters: rows,
    };
  });

  return { squads, totals: { pedidos: totalPedidos, pendientes: totalPendientes, compartidos } };
}
