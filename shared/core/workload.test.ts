import { describe, it, expect } from 'vitest';
import { computeWorkload, computeRequesterDetail } from './workload';
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

  it('no cuenta como compartido un issue que no se muestra en ningun squad', () => {
    // Ticket viejo y cerrado presente en los dos boards: ni pedido (fuera de rango)
    // ni pendiente (done). No debe inflar compartidos, porque no hay fila que explicar.
    const r = computeWorkload([iss({ id: 'A', boards: [9534, 9536],
      status: 'Finalizada', created_at: '2020-01-01T00:00:00.000Z' })], BOARDS, RANGE);
    expect(r.totals).toEqual({ pedidos: 0, pendientes: 0, compartidos: 0 });
    expect(r.squads.every(s => s.requesters.length === 0)).toBe(true);
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

const NOW = new Date('2026-06-30T00:00:00.000Z');
const dias = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

const P = { board_id: 9534, requester: 'Groot', scope: 'pendientes' as const,
            agingThresholdDays: 7, now: NOW };

describe('computeRequesterDetail', () => {
  it('filtra por board y solicitante, y ordena del mas viejo al mas nuevo', () => {
    const r = computeRequesterDetail([
      iss({ id: 'NUEVO', created_at: dias(3) }),
      iss({ id: 'VIEJO', created_at: dias(90) }),
      iss({ id: 'OTRO', requester: 'Snake', created_at: dias(50) }),
      iss({ id: 'OTROBOARD', boards: [9536], created_at: dias(50) }),
    ], P);
    expect(r.issues.map(i => i.id)).toEqual(['VIEJO', 'NUEVO']);
    expect(r.issues[0].edad_dias).toBe(90);
  });

  it('scope pendientes excluye lo cerrado; scope todos lo incluye segun el rango', () => {
    const data = [iss({ id: 'A', status: 'Backlog', created_at: dias(5) }),
                  iss({ id: 'B', status: 'Finalizada', created_at: dias(5) })];
    expect(computeRequesterDetail(data, P).issues.map(i => i.id)).toEqual(['A']);
    const todos = computeRequesterDetail(data, { ...P, scope: 'todos', from: '2026-06-01', to: '2026-06-30' });
    expect(todos.issues.map(i => i.id).sort()).toEqual(['A', 'B']);
  });

  it('marca estancado lo que nunca arranco y supera el umbral', () => {
    const r = computeRequesterDetail([
      iss({ id: 'PARADO', status: 'Backlog', created_at: dias(30) }),
      iss({ id: 'NUEVO', status: 'Backlog', created_at: dias(2) }),
      iss({ id: 'ANDANDO', status: 'IN PROGRESS', created_at: dias(30) }),
    ], P);
    const by = Object.fromEntries(r.issues.map(i => [i.id, i.estancado]));
    expect(by).toEqual({ PARADO: true, NUEVO: false, ANDANDO: false });
    expect(r.resumen.estancados).toBe(1);
  });

  it('resume abiertos, P1, edad maxima y mediana', () => {
    const r = computeRequesterDetail([
      iss({ id: 'A', created_at: dias(10), priority: 'High (P1)' }),
      iss({ id: 'B', created_at: dias(20), priority: 'Highest (P0)' }),
      iss({ id: 'C', created_at: dias(30), priority: 'Low (P3)' }),
      iss({ id: 'D', created_at: dias(40), priority: 'Mandatorio' }),
    ], P);
    expect(r.resumen.abiertos).toBe(4);
    expect(r.resumen.p1).toBe(3);
    expect(r.resumen.edad_max).toBe(40);
    expect(r.resumen.edad_p50).toBe(25);
  });

  it('en scope todos, el resumen describe solo lo abierto, no lo cerrado', () => {
    const r = computeRequesterDetail([
      iss({ id: 'ABIERTO', status: 'Backlog', created_at: dias(5), priority: 'Low (P3)' }),
      iss({ id: 'CERRADO', status: 'Finalizada', created_at: dias(300), priority: 'High (P1)' }),
    ], { ...P, scope: 'todos', from: '2020-01-01', to: '2026-06-30' });
    expect(r.issues.map(i => i.id)).toEqual(['CERRADO', 'ABIERTO']);  // la lista si los muestra
    expect(r.resumen.abiertos).toBe(1);
    expect(r.resumen.p1).toBe(0);        // el P1 esta cerrado: no se debe nada
    expect(r.resumen.edad_max).toBe(5);  // 5d del abierto, no 300d del cerrado
  });

  it('el bucket sin dato se pide con requester null', () => {
    const r = computeRequesterDetail([iss({ id: 'A', requester: null, created_at: dias(5) })],
      { ...P, requester: null });
    expect(r.issues.map(i => i.id)).toEqual(['A']);
  });

  it('sin issues devuelve resumen en cero', () => {
    const r = computeRequesterDetail([], P);
    expect(r.issues).toEqual([]);
    expect(r.resumen).toEqual({ abiertos: 0, estancados: 0, p1: 0, edad_max: 0, edad_p50: 0 });
  });
});
