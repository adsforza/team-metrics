// syncStore.ts importa AsyncStorage a nivel de módulo; sin este mock, el require
// real explota fuera de un dispositivo/simulador (mismo patrón que syncStore.test.ts).
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

jest.mock('../lib/directSync', () => ({
  ...jest.requireActual('../lib/directSync'),
  recomputeSnapshots: jest.fn().mockResolvedValue(undefined),
}));

// getDb() abre expo-sqlite real, que no corre fuera de un dispositivo/simulador.
// recomputeSnapshots ya está mockeada arriba, así que el valor devuelto acá no
// importa: sólo tiene que existir para que `recompute()` pueda pasarlo.
jest.mock('../lib/db', () => ({
  getDb: jest.fn().mockResolvedValue({}),
}));

import { useSyncStore } from '../store/syncStore';
import { useFilterStore } from '../store/filterStore';
import { recomputeSnapshots } from '../lib/directSync';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('recompute', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    (recomputeSnapshots as jest.Mock).mockReset();
    (recomputeSnapshots as jest.Mock).mockResolvedValue(undefined);
    useSyncStore.setState({ lastSyncStatus: null, errors: [] });
    useFilterStore.setState({ assignees: [] });
  });

  it('NO llama al server', async () => {
    await useSyncStore.getState().recompute();
    expect(mockFetch).not.toHaveBeenCalled();   // el requisito del pedido
  });

  it('bumpea dataVersion para que los hooks relean', async () => {
    const antes = useSyncStore.getState().dataVersion;
    await useSyncStore.getState().recompute();
    expect(useSyncStore.getState().dataVersion).toBe(antes + 1);
  });

  it('convierte la lista vacia del store a undefined para el core', async () => {
    // Store: [] = todos. Core: [] = nada. Sin la conversion, no elegir a nadie
    // mostraria cero datos.
    useFilterStore.getState().setAssignees([]);
    await useSyncStore.getState().recompute();
    expect((recomputeSnapshots as jest.Mock).mock.calls[0][1].assignees).toBeUndefined();
  });

  it('pasa la lista tal cual cuando hay gente elegida', async () => {
    useFilterStore.getState().setAssignees(['u1', 'u2']);
    await useSyncStore.getState().recompute();
    expect((recomputeSnapshots as jest.Mock).mock.calls[0][1].assignees).toEqual(['u1', 'u2']);
  });

  it('dos taps rapidos: el obsoleto ni siquiera ESCRIBE', async () => {
    // El punto de la guarda es proteger la escritura, no solo el set() a la UI: si
    // el recompute viejo llegara a llamar a recomputeSnapshots, pisaria SQLite con
    // el filtro anterior y la pantalla lo mostraria en la proxima relectura.
    useFilterStore.getState().setAssignees(['u1']);
    const p1 = useSyncStore.getState().recompute();
    useFilterStore.getState().setAssignees(['u2']);
    const p2 = useSyncStore.getState().recompute();
    await Promise.all([p1, p2]);
    expect(recomputeSnapshots).toHaveBeenCalledTimes(1);
    expect((recomputeSnapshots as jest.Mock).mock.calls[0][1].assignees).toEqual(['u2']);
  });

  it('los recomputes se serializan: nunca dos escrituras en vuelo', async () => {
    let enCurso = 0;
    let maxSimultaneo = 0;
    (recomputeSnapshots as jest.Mock).mockImplementation(async () => {
      enCurso++;
      maxSimultaneo = Math.max(maxSimultaneo, enCurso);
      await new Promise(r => setTimeout(r, 10));
      enCurso--;
    });

    useFilterStore.getState().setAssignees(['u1']);
    const p1 = useSyncStore.getState().recompute();
    await tick();                                  // p1 ya esta escribiendo
    useFilterStore.getState().setAssignees(['u2']);
    const p2 = useSyncStore.getState().recompute();
    await Promise.all([p1, p2]);

    expect(recomputeSnapshots).toHaveBeenCalledTimes(2);
    expect(maxSimultaneo).toBe(1);
  });

  it('si falla, deja lastSyncStatus partial ademas del error', async () => {
    // errors[] solo lo muestra la alerta de Ajustes despues de un sync(); sin tocar
    // el status, un recompute fallido quedaba invisible y la pantalla seguia con los
    // datos del filtro anterior para siempre.
    (recomputeSnapshots as jest.Mock).mockRejectedValue(new Error('boom'));
    await useSyncStore.getState().recompute();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('partial');
    expect(s.errors[0].endpoint).toBe('recompute');
    expect(s.errors[0].message).toContain('boom');
  });

  it('un fallo no envenena la cola: el siguiente recompute corre igual', async () => {
    (recomputeSnapshots as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await useSyncStore.getState().recompute();
    (recomputeSnapshots as jest.Mock).mockResolvedValue(undefined);
    const antes = useSyncStore.getState().dataVersion;
    await useSyncStore.getState().recompute();
    expect(useSyncStore.getState().dataVersion).toBe(antes + 1);
  });
});
