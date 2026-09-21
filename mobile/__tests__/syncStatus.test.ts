import { syncStatusText } from '../lib/syncStatus';

const NOW = Date.parse('2026-07-26T12:00:00Z');
const TWO_H_AGO = '2026-07-26T10:00:00Z';

describe('syncStatusText', () => {
  test('offline con datos previos muestra aviso y antigüedad', () => {
    expect(syncStatusText('offline', TWO_H_AGO, undefined, NOW)).toBe('⚠ Sin conexión · datos de hace 2h');
  });
  test('offline sin datos previos', () => {
    expect(syncStatusText('offline', null, undefined, NOW)).toBe('⚠ Sin conexión · sin datos aún');
  });
  test('partial', () => {
    expect(syncStatusText('partial', TWO_H_AGO, undefined, NOW)).toBe('sync parcial · hace 2h');
  });
  test('ok', () => {
    expect(syncStatusText('ok', TWO_H_AGO, undefined, NOW)).toBe('sync hace 2h');
  });
  test('sin timestamp y estado ok/null devuelve vacío', () => {
    expect(syncStatusText(null, null, undefined, NOW)).toBe('');
  });

  // Tests for mode indicator
  test('mode=direct con status ok agrega directo', () => {
    expect(syncStatusText('ok', TWO_H_AGO, 'direct', NOW)).toBe('sync hace 2h · directo');
  });
  test('mode=direct con status partial agrega directo', () => {
    expect(syncStatusText('partial', TWO_H_AGO, 'direct', NOW)).toBe('sync parcial · hace 2h · directo');
  });
  test('mode=direct con status offline no agrega directo', () => {
    expect(syncStatusText('offline', TWO_H_AGO, 'direct', NOW)).toBe('⚠ Sin conexión · datos de hace 2h');
  });
  test('mode=backend no agrega directo', () => {
    expect(syncStatusText('ok', TWO_H_AGO, 'backend', NOW)).toBe('sync hace 2h');
  });

  // Tests for raw freshness (Task 8)
  const AHORA = Date.parse('2026-09-20T12:00:00Z');

  it('la antiguedad sale del crudo, no del snapshot', () => {
    // Snapshot fresco pero crudo viejo: los numeros que se ven son viejos.
    const t = syncStatusText('ok', '2026-09-20T12:00:00Z', 'backend', AHORA, '2026-09-04T12:00:00Z');
    expect(t).toMatch(/16\s*d/);
  });

  it('sin crudo todavia, cae al timestamp del snapshot', () => {
    const t = syncStatusText('ok', '2026-09-20T12:00:00Z', 'backend', AHORA, undefined);
    expect(t).toBeTruthy();
    expect(t).not.toMatch(/16\s*d/);
  });

  it('offline con snapshot reciente pero crudo viejo: la antiguedad tambien sale del crudo', () => {
    // Fix round 1: la rama offline usaba lastSyncedAt (el snapshot) en vez de
    // antiguedad (crudo-o-snapshot). Es justo el caso donde mas importa: el
    // usuario esta viendo datos viejos sin poder actualizarlos.
    const t = syncStatusText('offline', '2026-09-20T12:00:00Z', 'backend', AHORA, '2026-09-04T12:00:00Z');
    expect(t).toMatch(/16\s*d/);
  });
});
