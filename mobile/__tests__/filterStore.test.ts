// filterStore.ts importa AsyncStorage a nivel de módulo; sin este mock, el require
// real explota fuera de un dispositivo/simulador (mismo patrón que syncStore.test.ts).
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import { migrateFilters } from '../store/filterStore';

describe('migrateFilters', () => {
  it('convierte el formato viejo de una persona a lista', () => {
    expect(migrateFilters({ assignee: 'u1', talla: null, timeRange: '30d' }, 0))
      .toMatchObject({ assignees: ['u1'] });
  });

  it('el viejo null (= todos) se vuelve lista vacia', () => {
    expect(migrateFilters({ assignee: null, talla: null, timeRange: '30d' }, 0))
      .toMatchObject({ assignees: [] });
  });

  it('no toca el resto de los filtros', () => {
    const out = migrateFilters({ assignee: 'u1', talla: 'M', timeRange: '90d' }, 0);
    expect(out.talla).toBe('M');
    expect(out.timeRange).toBe('90d');
  });

  it('un estado ya migrado pasa sin cambios', () => {
    const nuevo = { assignees: ['u1', 'u2'], talla: null, timeRange: '30d' };
    expect(migrateFilters(nuevo, 1)).toMatchObject({ assignees: ['u1', 'u2'] });
  });
});
