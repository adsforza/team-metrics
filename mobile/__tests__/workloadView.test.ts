import { splitRequesters, barPct } from '../lib/workloadView';

const r = (requester: string | null, pedidos: number, pendientes = 0) => ({ requester, pedidos, pendientes });

describe('splitRequesters', () => {
  const cinco = [r('Groot', 103, 5), r('Camel Case', 103, 1), r(null, 82, 31),
                 r('Devengers', 39, 0), r('La Teconeta', 30, 2)];

  it('corta en el top 3 y agrupa el resto con sus totales', () => {
    const s = splitRequesters(cinco);
    expect(s.top.map(x => x.requester)).toEqual(['Groot', 'Camel Case', null]);
    expect(s.rest).toHaveLength(2);
    expect(s.restPedidos).toBe(69);      // 39 + 30
    expect(s.restPendientes).toBe(2);    // 0 + 2
  });

  it('con 3 o menos no deja resto', () => {
    const s = splitRequesters(cinco.slice(0, 3));
    expect(s.rest).toEqual([]);
    expect(s.restPedidos).toBe(0);
    expect(s.restPendientes).toBe(0);
  });

  it('sin solicitantes no rompe', () => {
    const s = splitRequesters([]);
    expect(s.top).toEqual([]);
    expect(s.maxPedidos).toBe(0);
  });

  it('maxPedidos sale de la lista completa, no solo del top', () => {
    // Si saliera del top, la barra del resto podria pasarse del 100%.
    expect(splitRequesters([r('a', 10), r('b', 9), r('c', 8), r('d', 50)]).maxPedidos).toBe(50);
  });
});

describe('barPct', () => {
  it('es proporcional al maximo', () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(100, 100)).toBe(100);
  });

  it('no divide por cero cuando el squad no tiene pedidos', () => {
    expect(barPct(0, 0)).toBe(0);
  });
});
