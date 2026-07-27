import { syncStatusText } from '../lib/syncStatus';

const NOW = Date.parse('2026-07-26T12:00:00Z');
const TWO_H_AGO = '2026-07-26T10:00:00Z';

describe('syncStatusText', () => {
  test('offline con datos previos muestra aviso y antigüedad', () => {
    expect(syncStatusText('offline', TWO_H_AGO, NOW)).toBe('⚠ Sin conexión · datos de hace 2h');
  });
  test('offline sin datos previos', () => {
    expect(syncStatusText('offline', null, NOW)).toBe('⚠ Sin conexión · sin datos aún');
  });
  test('partial', () => {
    expect(syncStatusText('partial', TWO_H_AGO, NOW)).toBe('sync parcial · hace 2h');
  });
  test('ok', () => {
    expect(syncStatusText('ok', TWO_H_AGO, NOW)).toBe('sync hace 2h');
  });
  test('sin timestamp y estado ok/null devuelve vacío', () => {
    expect(syncStatusText(null, null, NOW)).toBe('');
  });
});
