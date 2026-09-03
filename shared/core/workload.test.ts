import { describe, it, expect } from 'vitest';
import { computeWorkload } from './workload';
import type { CoreIssueWorkload } from './types';

const iss = (over: Partial<CoreIssueWorkload>): CoreIssueWorkload => ({
  id: 'X', title: 'T', status: 'Backlog', assignee_id: null, talla: null,
  created_at: '2026-06-15T00:00:00.000Z', last_transition_at: null,
  requester: 'Groot', priority: null, boards: [9534], ...over,
});

const BOARDS = [{ id: 9534, name: 'Black Team Infra' }, { id: 9536, name: 'Blue Team Infra' }];
const RANGE = { from: '2026-06-01', to: '2026-06-30' };

describe('computeWorkload', () => {
  it('cuenta como pedido lo creado dentro del rango, incluido lo cerrado', () => {
    const r = computeWorkload([
      iss({ id: 'A', status: 'Finalizada' }),
      iss({ id: 'B', status: 'Backlog' }),
    ], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(2);
  });

  it('excluye del rango lo creado fuera de el', () => {
    const r = computeWorkload([iss({ id: 'A', created_at: '2026-01-01T00:00:00.000Z' })], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(0);
  });

  it('cuenta pendientes lo abierto hoy, sin importar el rango', () => {
    const r = computeWorkload([
      iss({ id: 'A', status: 'Backlog', created_at: '2020-01-01T00:00:00.000Z' }),
      iss({ id: 'B', status: 'Finalizada' }),
      iss({ id: 'C', status: 'Cancelado' }),
    ], BOARDS, RANGE);
    const black = r.squads.find(s => s.board_id === 9534)!;
    expect(black.pendientes).toBe(1);
    expect(black.pedidos).toBe(2);   // B y C entraron en el rango; A no
  });

  it('un issue en dos boards cuenta en ambos squads y aparece en compartidos', () => {
    const r = computeWorkload([iss({ id: 'A', boards: [9534, 9536] })], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.pedidos).toBe(1);
    expect(r.squads.find(s => s.board_id === 9536)!.pedidos).toBe(1);
    expect(r.totals.pedidos).toBe(1);          // el total NO lo duplica
    expect(r.totals.compartidos).toBe(1);
  });

  it('agrupa el requester nulo en un bucket propio', () => {
    const r = computeWorkload([
      iss({ id: 'A', requester: null }),
      iss({ id: 'B', requester: null }),
      iss({ id: 'C', requester: 'Groot' }),
    ], BOARDS, RANGE);
    const rs = r.squads.find(s => s.board_id === 9534)!.requesters;
    expect(rs.find(x => x.requester === null)!.pedidos).toBe(2);
    expect(rs.find(x => x.requester === 'Groot')!.pedidos).toBe(1);
  });

  it('ordena los solicitantes por pedidos desc, desempatando por nombre', () => {
    const r = computeWorkload([
      iss({ id: 'A', requester: 'Zeta' }), iss({ id: 'B', requester: 'Zeta' }),
      iss({ id: 'C', requester: 'Alfa' }), iss({ id: 'D', requester: 'Beta' }),
    ], BOARDS, RANGE);
    expect(r.squads.find(s => s.board_id === 9534)!.requesters.map(x => x.requester))
      .toEqual(['Zeta', 'Alfa', 'Beta']);
  });

  it('devuelve todos los boards conocidos aunque no tengan issues', () => {
    const r = computeWorkload([], BOARDS, RANGE);
    expect(r.squads.map(s => s.name)).toEqual(['Black Team Infra', 'Blue Team Infra']);
    expect(r.totals).toEqual({ pedidos: 0, pendientes: 0, compartidos: 0 });
  });

  it('ignora issues cuyo board no esta en la lista', () => {
    const r = computeWorkload([iss({ id: 'A', boards: [999] })], BOARDS, RANGE);
    expect(r.totals.pedidos).toBe(0);
  });

  it('sin rango cuenta todos los pedidos', () => {
    const r = computeWorkload([iss({ id: 'A', created_at: '2001-01-01T00:00:00.000Z' })], BOARDS, {});
    expect(r.totals.pedidos).toBe(1);
  });
});
