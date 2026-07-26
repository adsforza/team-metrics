# Mobile Offline Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app mobile siga navegable con los datos de la última sync cuando no hay conectividad con el server DEV, avisando el estado offline y sin pisar el timestamp.

**Architecture:** La app ya es offline-first (pantallas leen de SQLite local; `performSync` es el único acceso a red). Agregamos: un chequeo de alcanzabilidad corto que gatea el sync, un estado de resultado (`ok`/`partial`/`offline`) en el store que preserva el timestamp cuando no baja data, un aviso en el header derivado de ese estado, y un auto-sync best-effort al abrir.

**Tech Stack:** Expo v57 (React Native + TypeScript), Zustand, expo-sqlite, AsyncStorage, Jest (`jest-expo`). Sin dependencias nuevas (`fetch` nativo).

## Global Constraints

- Expo SDK v57 — leer https://docs.expo.dev/versions/v57.0.0/ antes de tocar código (`mobile/AGENTS.md`). Este plan no agrega APIs de Expo nuevas.
- Sin dependencias npm nuevas.
- TypeScript en todo el código.
- Correr tests con `npm test` desde `mobile/` (preset `jest-expo`).
- Commits frecuentes, uno por tarea. Formato de trailer de commit igual al repo (ver ejemplos abajo).

---

### Task 1: Helper de alcanzabilidad del server

**Files:**
- Modify: `mobile/lib/api.ts` (agregar `isServerReachable`)
- Test: `mobile/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `getBaseUrl()` de `mobile/lib/api.ts`.
- Produces: `export async function isServerReachable(): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Agregar al final de `mobile/__tests__/api.test.ts` (dentro del archivo; mantené los mocks existentes de AsyncStorage). Si el archivo no mockea `fetch`, agregá `global.fetch = jest.fn();` arriba del `describe`.

```ts
import { isServerReachable } from '../lib/api';

describe('isServerReachable', () => {
  beforeEach(() => { (global.fetch as jest.Mock) = jest.fn(); });

  test('true cuando /api/config responde ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await expect(isServerReachable()).resolves.toBe(true);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/config');
  });

  test('false cuando el fetch rechaza (offline/timeout)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(isServerReachable()).resolves.toBe(false);
  });

  test('false cuando responde no-ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(isServerReachable()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/api.test.ts -t isServerReachable`
Expected: FAIL con "isServerReachable is not a function" (o import undefined).

- [ ] **Step 3: Write minimal implementation**

Agregar a `mobile/lib/api.ts`:

```ts
export async function isServerReachable(): Promise<boolean> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/api.test.ts -t isServerReachable`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/api.ts mobile/__tests__/api.test.ts
git commit -m "feat(mobile): helper isServerReachable con timeout corto"
```

---

### Task 2: `performSync` no pisa el timestamp y reporta conteos

**Files:**
- Modify: `mobile/lib/sync.ts` (interfaz `SyncResult`, guard de `LAST_SYNCED_KEY`, retorno)
- Test: `mobile/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `SyncResult` extendido: `{ success: boolean; errors: SyncError[]; syncedAt: string; okCount: number; failCount: number }`. `okCount` = endpoints `fulfilled` (de los 10 principales + 6 comparaciones); `LAST_SYNCED_KEY` solo se escribe si `okCount > 0`.

- [ ] **Step 1: Write the failing test**

Agregar a `mobile/__tests__/sync.test.ts` (usa el `mockAllFetch` existente). Importar `AsyncStorage` y `LAST_SYNCED_KEY`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY } from '../lib/sync';

test('reporta okCount/failCount y NO escribe LAST_SYNCED_KEY si todo falla', async () => {
  (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  const result = await performSync();
  expect(result.okCount).toBe(0);
  expect(result.failCount).toBeGreaterThan(0);
  expect(result.success).toBe(false);
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(LAST_SYNCED_KEY, expect.anything());
});

test('escribe LAST_SYNCED_KEY cuando al menos un endpoint responde', async () => {
  mockAllFetch();
  const result = await performSync();
  expect(result.okCount).toBeGreaterThan(0);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(LAST_SYNCED_KEY, result.syncedAt);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/sync.test.ts -t "okCount"`
Expected: FAIL (`result.okCount` es `undefined`).

- [ ] **Step 3: Write minimal implementation**

En `mobile/lib/sync.ts`:

Reemplazar la interfaz:

```ts
export interface SyncResult { success: boolean; errors: SyncError[]; syncedAt: string; okCount: number; failCount: number }
```

Después del bloque `await db.withTransactionAsync(...)` y ANTES del `await AsyncStorage.setItem(LAST_SYNCED_KEY, syncedAt);`, calcular conteos y reemplazar el `setItem` incondicional:

```ts
  const allResults = [
    kpi, throughput, team, aging, wipRisk, bottleneck, forecast, cfd, issues, byTalla,
    ...comparisons,
  ];
  const okCount = allResults.filter(r => r.status === 'fulfilled').length;
  const failCount = allResults.length - okCount;

  if (okCount > 0) {
    await AsyncStorage.setItem(LAST_SYNCED_KEY, syncedAt);
  }
```

Y el `return` final:

```ts
  return { success: errors.length === 0, errors, syncedAt, okCount, failCount };
```

(Dejar el `try { ...fetch('/api/config')... }` como está.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/sync.test.ts`
Expected: PASS (los 2 tests viejos + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/sync.ts mobile/__tests__/sync.test.ts
git commit -m "feat(mobile): performSync reporta conteos y no pisa el timestamp si no baja data"
```

---

### Task 3: Máquina de estados del sync en el store

**Files:**
- Modify: `mobile/store/syncStore.ts`
- Test: `mobile/__tests__/syncStore.test.ts` (crear)

**Interfaces:**
- Consumes: `performSync` (Task 2), `isServerReachable` (Task 1).
- Produces: `SyncState` con nuevo campo `lastSyncStatus: 'ok' | 'partial' | 'offline' | null`. Regla: si no es reachable → `offline` sin tocar `lastSyncedAt`; si `okCount===0` → `offline`; si `failCount>0` → `partial`; si no → `ok`. `lastSyncedAt` solo se actualiza cuando `okCount>0`.

- [ ] **Step 1: Write the failing test**

Crear `mobile/__tests__/syncStore.test.ts`:

```ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../lib/api', () => ({ isServerReachable: jest.fn() }));
jest.mock('../lib/sync', () => ({ performSync: jest.fn() }));

import { isServerReachable } from '../lib/api';
import { performSync } from '../lib/sync';
import { useSyncStore } from '../store/syncStore';

const reset = () => useSyncStore.setState({
  loading: false, lastSyncedAt: 'PREV', errors: [], dataVersion: 0, lastSyncStatus: null,
});

describe('syncStore.sync', () => {
  beforeEach(() => { jest.clearAllMocks(); reset(); });

  test('offline cuando el server no es alcanzable, preserva timestamp y no sincroniza', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(false);
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('offline');
    expect(s.lastSyncedAt).toBe('PREV');
    expect(performSync).not.toHaveBeenCalled();
    expect(s.loading).toBe(false);
  });

  test('offline cuando reachable pero okCount 0, sin pisar timestamp', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: false, errors: [{}], syncedAt: 'NOW', okCount: 0, failCount: 16 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('offline');
    expect(s.lastSyncedAt).toBe('PREV');
  });

  test('partial cuando hay fallos parciales, actualiza timestamp', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: false, errors: [{}], syncedAt: 'NOW', okCount: 10, failCount: 6 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('partial');
    expect(s.lastSyncedAt).toBe('NOW');
  });

  test('ok cuando todo responde', async () => {
    (isServerReachable as jest.Mock).mockResolvedValue(true);
    (performSync as jest.Mock).mockResolvedValue({ success: true, errors: [], syncedAt: 'NOW', okCount: 16, failCount: 0 });
    await useSyncStore.getState().sync();
    const s = useSyncStore.getState();
    expect(s.lastSyncStatus).toBe('ok');
    expect(s.lastSyncedAt).toBe('NOW');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/syncStore.test.ts`
Expected: FAIL (`lastSyncStatus` es `undefined`; `performSync` se llama aunque no sea reachable).

- [ ] **Step 3: Write minimal implementation**

Reescribir `mobile/store/syncStore.ts`:

```ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_SYNCED_KEY, performSync, SyncError } from '../lib/sync';
import { isServerReachable } from '../lib/api';
import { dateRangeFor, useFilterStore } from './filterStore';

export type SyncStatus = 'ok' | 'partial' | 'offline' | null;

interface SyncState {
  loading: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: SyncStatus;
  errors: SyncError[];
  dataVersion: number;
  loadLastSynced: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  loading: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  errors: [],
  dataVersion: 0,

  loadLastSynced: async () => {
    const val = await AsyncStorage.getItem(LAST_SYNCED_KEY);
    set({ lastSyncedAt: val });
  },

  sync: async () => {
    if (get().loading) return;
    set({ loading: true, errors: [] });

    if (!(await isServerReachable())) {
      set({ loading: false, lastSyncStatus: 'offline' });
      return;
    }

    try {
      const { timeRange, assignee } = useFilterStore.getState();
      const result = await performSync(dateRangeFor(timeRange), assignee);
      const status: SyncStatus =
        result.okCount === 0 ? 'offline' : result.failCount > 0 ? 'partial' : 'ok';
      set({
        loading: false,
        lastSyncStatus: status,
        lastSyncedAt: result.okCount > 0 ? result.syncedAt : get().lastSyncedAt,
        errors: result.errors,
        dataVersion: get().dataVersion + 1,
      });
    } catch (err) {
      set({
        loading: false,
        lastSyncStatus: 'offline',
        errors: [{ endpoint: 'global', message: String(err) }],
      });
    }
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/syncStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/store/syncStore.ts mobile/__tests__/syncStore.test.ts
git commit -m "feat(mobile): estado de sync ok/partial/offline con pre-check de alcanzabilidad"
```

---

### Task 4: Texto de aviso y `SyncHeader`

**Files:**
- Create: `mobile/lib/syncStatus.ts`
- Modify: `mobile/components/SyncHeader.tsx`
- Test: `mobile/__tests__/syncStatus.test.ts` (crear)

**Interfaces:**
- Consumes: `SyncStatus` (concepto de Task 3; se redeclara localmente para no acoplar el header al store).
- Produces: `syncStatusText(status, lastSyncedAt, now?)` y `timeAgo(iso, now?)` en `mobile/lib/syncStatus.ts`.

- [ ] **Step 1: Write the failing test**

Crear `mobile/__tests__/syncStatus.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/syncStatus.test.ts`
Expected: FAIL (módulo `../lib/syncStatus` no existe).

- [ ] **Step 3: Write minimal implementation**

Crear `mobile/lib/syncStatus.ts`:

```ts
export type SyncStatus = 'ok' | 'partial' | 'offline' | null;

export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export function syncStatusText(
  status: SyncStatus, lastSyncedAt: string | null, now: number = Date.now(),
): string {
  if (status === 'offline') {
    return lastSyncedAt
      ? `⚠ Sin conexión · datos de ${timeAgo(lastSyncedAt, now)}`
      : '⚠ Sin conexión · sin datos aún';
  }
  if (!lastSyncedAt) return '';
  if (status === 'partial') return `sync parcial · ${timeAgo(lastSyncedAt, now)}`;
  return `sync ${timeAgo(lastSyncedAt, now)}`;
}
```

Nota: `timeAgo` devuelve "hace 2h", por eso `syncStatusText` compone `datos de ${timeAgo(...)}` → "datos de hace 2h" y `sync ${timeAgo(...)}` → "sync hace 2h".

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/syncStatus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Actualizar `SyncHeader.tsx`**

Reemplazar el `timeAgo` local y el render del timestamp por el helper y el estado del store. `mobile/components/SyncHeader.tsx` completo:

```tsx
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '../lib/theme';
import { useSyncStore } from '../store/syncStore';
import { syncStatusText } from '../lib/syncStatus';

export function SyncHeader() {
  const { sync, loading, lastSyncedAt, lastSyncStatus } = useSyncStore();
  const label = syncStatusText(lastSyncStatus, lastSyncedAt);
  const offline = lastSyncStatus === 'offline';
  return (
    <View style={s.row}>
      {label !== '' && (
        <Text style={[s.timestamp, offline && s.offline]}>{label}</Text>
      )}
      <TouchableOpacity style={s.button} onPress={sync} disabled={loading}>
        {loading ? (
          <ActivityIndicator size={12} color={Colors.primary} />
        ) : (
          <Feather name="refresh-cw" size={12} color={Colors.primary} />
        )}
        <Text style={s.buttonText}>Sync</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timestamp: { fontSize: 12, color: Colors.textSubtle },
  offline: { color: Colors.warning ?? '#f59e0b' },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.primary,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  buttonText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
});
```

Antes de guardar, verificar en `mobile/lib/theme.ts` si existe `Colors.warning`; si no, usar el literal `'#f59e0b'` directamente (el `?? '#f59e0b'` ya cubre el caso, pero evitá referenciar una key inexistente si TS se queja — en ese caso poné `color: '#f59e0b'`).

- [ ] **Step 6: Verificar typecheck y tests**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/syncStatus.test.ts`
Expected: sin errores de tipos; 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/syncStatus.ts mobile/components/SyncHeader.tsx mobile/__tests__/syncStatus.test.ts
git commit -m "feat(mobile): aviso de sync offline/parcial en el header"
```

---

### Task 5: Auto-sync best-effort al abrir

**Files:**
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `useSyncStore.getState().sync` (Task 3).
- Produces: nada nuevo. Efecto de arranque no bloqueante.

- [ ] **Step 1: Implementar el disparo al arranque**

En `mobile/app/_layout.tsx`, el `useEffect` de arranque queda así (dispara el sync sin `await`, tras cargar la DB y el timestamp):

```tsx
  useEffect(() => {
    getDb().catch(console.error);
    loadLastSynced().then(() => {
      // best-effort: en casa (server up) refresca; offline el pre-check corta y marca offline.
      useSyncStore.getState().sync();
    });
  }, []);
```

(`useSyncStore` ya está importado en el archivo.)

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificación manual (device/simulador)**

1. `cd server && npm run dev` (server up). En la app, abrir → debería auto-sincronizar y mostrar "sync recién".
2. Cortar el server (Ctrl-C). Cerrar y reabrir la app → tras ~3s (pre-check) el header muestra "⚠ Sin conexión · datos de hace Xh", el timestamp NO avanza, y todas las tabs siguen mostrando el cache (no `EmptyState`).
3. Tocar "Sync" offline → falla rápido (no ~20s), mantiene el aviso y el cache.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat(mobile): auto-sync best-effort al abrir la app"
```

---

## Self-Review

**Spec coverage:**
- Chequeo de alcanzabilidad → Task 1. ✓
- No pisar timestamp / conteos → Task 2. ✓
- Estado ok/partial/offline en el store + pre-check gate → Task 3. ✓
- Aviso en el header → Task 4. ✓
- Auto-sync best-effort al abrir → Task 5. ✓
- Testing unit del reducer de estado → Task 3; texto del aviso → Task 4; guard del timestamp → Task 2. ✓
- Verificación manual → Task 5, Step 3. ✓

**Type consistency:** `SyncResult` (Task 2) = `{ success, errors, syncedAt, okCount, failCount }`, consumido igual en Task 3. `SyncStatus` = `'ok'|'partial'|'offline'|null` en store (Task 3) y en `syncStatus.ts` (Task 4, redeclarado a propósito). `isServerReachable(): Promise<boolean>` (Task 1) consumido en Task 3. `syncStatusText(status, lastSyncedAt, now?)` (Task 4) consumido en `SyncHeader`. Consistente.

**Placeholder scan:** sin TBD/TODO; todo el código está explícito.

**Out of scope (del spec):** detección real de red (`expo-network`), reintento auto al volver la conexión, sync en background.
