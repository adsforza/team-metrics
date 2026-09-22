import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { isServerReachable, triggerReclassify } from '../lib/api';
import { getDirectConfig } from '../lib/directConfig';
import { directSync, directReclassify, recomputeSnapshots } from '../lib/directSync';
import { getDb, loadCoreIssues } from '../lib/db';
import { dateRangeFor, useFilterStore } from './filterStore';
import type { SyncStatus } from '../lib/syncStatus';
import type { SyncProgress } from '../lib/progress';

export type { SyncStatus };
export type SyncMode = 'backend' | 'direct' | null;

export type ReclassifyOutcome =
  | { mode: 'backend'; pending: number }
  | { mode: 'direct'; classified: number; failCount: number }
  | { mode: 'none' };

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus;
  lastSyncMode: SyncMode;
  errors: SyncError[];
  dataVersion: number;
  progress: SyncProgress | null;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
  reclassify: () => Promise<ReclassifyOutcome>;
  recompute: () => Promise<void>;
}

// Generacion del ultimo `recompute()` pedido. Vive fuera del store porque es
// control de concurrencia, no estado de UI: nadie tiene que re-renderizar por esto.
let recomputeGen = 0;
// Cola de un solo carril para los recomputes: ver el comentario en `recompute()`.
let recomputeChain: Promise<void> = Promise.resolve();

// Convencion store -> core, en un solo lugar:
//   store `assignees: []`  = "todos"      (no hay filtro elegido)
//   core  `assignees: []`  = "no matchea nada"
// Por eso la lista vacia viaja al core como `undefined`. Cada accion la calcula
// una vez arriba y la reusa; no hay otra forma de traducir esto en el store.
const toCoreAssignees = (assignees: string[]): string[] | undefined =>
  assignees.length > 0 ? assignees : undefined;

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncMode: null,
  errors: [],
  dataVersion: 0,
  progress: null,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });

    const { timeRange, assignees } = useFilterStore.getState();
    // Los endpoints HTTP del server aceptan un solo `?assignee=`, asi que para ese
    // camino mandamos el primero elegido. El bundle que devuelven queda truncado si
    // habia varias personas: por eso al final de la accion recalculamos local (ver abajo).
    const assignee = assignees[0] ?? null;
    // El camino direct NO tiene esa limitacion y no debe truncar: `fetchBoardIssues`
    // baja por proyecto y fecha (nunca por persona) y `config.filters` se usa solo
    // dentro de `recomputeSnapshots`, o sea filtrado puramente local.
    const coreAssignees = toCoreAssignees(assignees);
    const range = dateRangeFor(timeRange);
    const onProgress = (p: SyncProgress) => set({ progress: p });

    try {
      let result;
      let mode: SyncMode;

      if (await isServerReachable()) {
        result = await performSync(range, assignee, onProgress);
        mode = 'backend';
      } else {
        const cfg = await getDirectConfig();
        if (!cfg) {
          set({ loading: false, lastSyncStatus: 'offline', progress: null });
          return;
        }
        const db = await getDb();
        result = await directSync(db, {
          boards: cfg.boards,
          geminiKey: cfg.geminiKey,
          filters: { from: range.from, to: range.to, assignees: coreAssignees },
        }, { onProgress });
        mode = 'direct';
      }

      const status: SyncStatus =
        result.okCount === 0 ? 'offline' : result.failCount > 0 ? 'partial' : 'ok';
      set({
        loading: false,
        lastSyncStatus: status,
        lastSyncMode: mode,
        lastSyncedAt: result.okCount > 0 ? result.syncedAt : get().lastSyncedAt,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
        progress: null,
      });

      // El server solo filtra por una persona; el bundle que devuelve queda truncado
      // si hay varias elegidas. Recalculamos local con la lista completa sobre el
      // crudo que /api/raw acaba de refrescar. (El camino direct ya recibio la lista
      // entera mas arriba, no necesita esta pasada.)
      // `assignees.length > 1` es la condicion exacta: con 0 o 1 persona el bundle
      // del server YA es correcto, y reemplazarlo por uno calculado sobre el espejo
      // local (que es un subconjunto del crudo del server) solo puede empeorarlo.
      if (mode === 'backend' && result.okCount > 0 && assignees.length > 1) {
        const locales = await loadCoreIssues(await getDb());
        if (locales.length > 0) {
          // La guarda `length > 0` es obligatoria: si el celular todavia no bajo el
          // crudo, recalcular degradaria snapshots buenos del server a datos vacios.
          await get().recompute();
        } else {
          // Sin crudo local no hay forma de filtrar por varias personas: lo que quedo
          // en pantalla es el bundle truncado a `assignees[0]`, o sea numeros de UNA
          // persona mientras la barra dice "N personas". Eso no puede pasar callado.
          set({
            lastSyncStatus: 'partial',
            errors: [
              ...get().errors,
              {
                // Etiqueta propia y no '/api/raw': la alerta de Ajustes tiene un
                // texto fijo para ese endpoint y se comeria este mensaje.
                endpoint: 'filtro-personas',
                message: 'No se pudo filtrar por varias personas: falta bajar los datos locales. '
                  + `Los numeros que ves son los de una sola de las ${assignees.length} personas elegidas.`,
              },
            ],
          });
        }
      }
    } catch (err) {
      set({
        loading: false,
        lastSyncStatus: 'offline',
        errors: [{ endpoint: 'global', message: String(err) }],
        progress: null,
      });
    }
  },

  reclassify: async () => {
    if (get().loading) return { mode: 'none' };
    set({ loading: true, errors: [] });

    const { timeRange, assignees } = useFilterStore.getState();
    // `directReclassify` es camino local: no baja de Jira, solo clasifica pendientes
    // y recalcula snapshots. Recibe la lista entera (ver comentario en `sync()`).
    const coreAssignees = toCoreAssignees(assignees);
    const range = dateRangeFor(timeRange);
    const onProgress = (p: SyncProgress) => set({ progress: p });

    try {
      // Con backend disponible, la reclasificación corre en el server (mejor cuota/latencia).
      if (await isServerReachable()) {
        const r = await triggerReclassify();
        set({ loading: false, progress: null });
        return { mode: 'backend', pending: r.pending ?? 0 };
      }

      const cfg = await getDirectConfig();
      if (!cfg) {
        set({ loading: false, lastSyncStatus: 'offline', progress: null });
        return { mode: 'none' };
      }
      const db = await getDb();
      const result = await directReclassify(db, {
        boards: cfg.boards,
        geminiKey: cfg.geminiKey,
        filters: { from: range.from, to: range.to, assignees: coreAssignees },
      }, { onProgress });
      set({
        loading: false,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
        progress: null,
      });
      return { mode: 'direct', classified: result.classified, failCount: result.failCount };
    } catch (err) {
      set({ loading: false, errors: [{ endpoint: 'reclassify', message: String(err) }], progress: null });
      return { mode: 'none' };
    }
  },

  // Recalcula los snapshots desde el crudo local (SQLite) sin red: usado cuando
  // sólo cambió el filtro de personas y los datos ya están sincronizados en el
  // celular. No llama al server ni a Jira — es 100% local.
  recompute: async () => {
    const gen = ++recomputeGen;
    // Se encadenan para que dos taps rapidos no escriban el bundle a la vez: el
    // chequeo tiene que cubrir la ESCRITURA, no solo el aviso a la UI. Si solo
    // protegiera el set(), el recompute viejo pisaria SQLite con datos de otro
    // filtro y la pantalla recien lo mostraria en la proxima relectura.
    recomputeChain = recomputeChain.then(async () => {
      if (gen !== recomputeGen) return;   // quedo obsoleto mientras esperaba el turno
      try {
        const { timeRange, assignees } = useFilterStore.getState();
        const coreAssignees = toCoreAssignees(assignees);
        const range = dateRangeFor(timeRange);
        const db = await getDb();
        const now = new Date();
        await recomputeSnapshots(db, {
          from: range.from, to: range.to, assignees: coreAssignees,
        }, now, now.toISOString());
        set({ dataVersion: get().dataVersion + 1 });
      } catch (err) {
        // `partial` ademas del error: `errors[]` solo lo renderiza la alerta de
        // Ajustes despues de un `sync()`, asi que un recompute fallido quedaba
        // invisible — la barra diciendo "3 personas" sobre los datos del filtro
        // anterior, indefinidamente. La cabecera si mira `lastSyncStatus`.
        set({
          lastSyncStatus: 'partial',
          errors: [{ endpoint: 'recompute', message: String(err) }],
        });
      }
    });
    return recomputeChain;
  },
}));
