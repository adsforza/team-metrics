import { categorize } from './statusCategories';
import type { CoreIssueWorkload, Talla } from './types';

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

    const esPedido = enRango(issue.created_at, params.from, params.to);
    const esPend = isPendiente(issue.status);
    if (!esPedido && !esPend) continue;

    // compartidos se cuenta DESPUES del filtro, a proposito: el numero existe para
    // explicar por que la suma de los squads supera al total en pantalla, asi que
    // solo puede contar issues que efectivamente se muestran. Contarlo antes hace
    // que un ticket viejo y cerrado presente en los dos boards infle el contador
    // sin que haya ninguna fila a la que atribuirselo.
    if (mine.length > 1) compartidos++;

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

export interface WorkloadIssue {
  id: string; title: string; status: string;
  assignee_id: string | null; talla: Talla | null; priority: string | null;
  created_at: string; edad_dias: number; estancado: boolean;
}
export interface RequesterDetail {
  issues: WorkloadIssue[];
  resumen: { abiertos: number; estancados: number; p1: number; edad_max: number; edad_p50: number };
}

const MS_DAY = 86_400_000;
const P1_PRIORITIES = ['Highest (P0)', 'High (P1)', 'Mandatorio'];

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function computeRequesterDetail(
  issues: CoreIssueWorkload[],
  params: {
    board_id: number; requester: string | null;
    scope: 'pendientes' | 'todos';
    from?: string; to?: string;
    agingThresholdDays: number; now: Date;
  },
): RequesterDetail {
  const t = params.now.getTime();

  const rows: WorkloadIssue[] = issues
    .filter(i => i.boards.includes(params.board_id) && i.requester === params.requester)
    .filter(i => params.scope === 'pendientes'
      ? isPendiente(i.status)
      : isPendiente(i.status) || enRango(i.created_at, params.from, params.to))
    .map(i => {
      const edad_dias = Math.floor((t - new Date(i.created_at).getTime()) / MS_DAY);
      const cat = categorize(i.status);
      const nuncaArranco = cat === 'todo' || cat === 'waiting';
      return {
        id: i.id, title: i.title, status: i.status,
        assignee_id: i.assignee_id, talla: i.talla, priority: i.priority,
        created_at: i.created_at, edad_dias,
        estancado: nuncaArranco && edad_dias > params.agingThresholdDays,
      };
    })
    .sort((a, b) => b.edad_dias - a.edad_dias || a.id.localeCompare(b.id));

  const abiertosRows = rows.filter(r => isPendiente(r.status));
  return {
    issues: rows,
    resumen: {
      abiertos: abiertosRows.length,
      estancados: rows.filter(r => r.estancado).length,
      p1: rows.filter(r => r.priority !== null && P1_PRIORITIES.includes(r.priority)).length,
      edad_max: rows.length ? Math.max(...rows.map(r => r.edad_dias)) : 0,
      edad_p50: mediana(rows.map(r => r.edad_dias)),
    },
  };
}
