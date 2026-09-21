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

describe('recompute', () => {
  beforeEach(() => { mockFetch.mockClear(); (recomputeSnapshots as jest.Mock).mockClear(); });

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
});
