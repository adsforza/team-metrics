# Mobile offline resilience — design

**Date:** 2026-07-26
**Status:** approved

## Context

El objetivo del usuario: en casa, con el server DEV levantado, la app mobile
sincroniza y trae todo; cuando pierde conectividad, la app sigue navegable con
los datos de la última sincronización y avisa que está offline — sin quedar en
`EmptyState` ni colgarse.

La app ya es **offline-first**: todas las pantallas leen de una SQLite local
(`mobile/lib/db.ts`) y el único punto que toca la red es `performSync`
(`mobile/lib/sync.ts`), disparado **manualmente** desde el botón Sync
(`mobile/components/SyncHeader.tsx`). Después de un sync, el cache ya se navega
offline.

### Problemas actuales

1. **El timestamp miente offline.** `performSync` usa `Promise.allSettled`; aun
   si todos los fetches fallan, ejecuta `AsyncStorage.setItem(LAST_SYNCED_KEY,
   syncedAt)` incondicionalmente (`sync.ts:166`), dejando "sync recién" cuando no
   bajó nada.
2. **Sin aviso de offline.** `syncStore` guarda `errors` pero `SyncHeader` no los
   muestra. El usuario no tiene señal de que el sync falló.
3. **Hang de ~20s.** Offline, tocar Sync espera los timeouts de los 16 fetches
   (10s c/u, en dos tandas) antes de "fallar" en silencio.

El cache NO se pierde offline: los `DELETE FROM` están dentro de los bloques
`if (result.status === 'fulfilled')`, así que un fetch fallido no borra data.

## Diseño (Enfoque A — sin dependencias nuevas)

### 1. Chequeo de alcanzabilidad — `mobile/lib/api.ts`

Nuevo helper `isServerReachable(): Promise<boolean>` que hace `fetch` a
`${baseUrl}/api/config` con `AbortSignal.timeout(3000)` y devuelve `true` si
responde OK, `false` si tira / timeout. Sin dependencias externas.

### 2. `performSync` / estado de sync — `mobile/lib/sync.ts`, `mobile/store/syncStore.ts`

- `performSync` deja de escribir `LAST_SYNCED_KEY` cuando no se escribió ningún
  dato. `SyncResult` se extiende con conteos para poder decidir:
  `{ success, errors, syncedAt, okCount, failCount }` (okCount = endpoints
  `fulfilled`). El `setItem(LAST_SYNCED_KEY, ...)` se ejecuta solo si
  `okCount > 0`.
- `syncStore.sync()`:
  1. `if (loading) return;` `set({ loading: true, errors: [] })`.
  2. `if (!await isServerReachable())` → `set({ loading:false, lastSyncStatus:'offline' })`
     y retorna (preserva `lastSyncedAt` y el cache). No dispara los 16 fetches.
  3. Reachable → `performSync(...)`. Setea:
     - `lastSyncStatus`: `okCount === 0 ? 'offline' : failCount > 0 ? 'partial' : 'ok'`.
     - `lastSyncedAt`: solo se actualiza si `okCount > 0`.
     - `errors`, `dataVersion + 1`.
  4. `catch` → `lastSyncStatus: 'offline'` (no pisar timestamp).
- Nuevo campo del store: `lastSyncStatus: 'ok' | 'partial' | 'offline' | null`.

### 3. Aviso en `SyncHeader` — `mobile/components/SyncHeader.tsx`

Según `lastSyncStatus`:
- `offline` → "⚠ Sin conexión · datos de hace Xh" (usa `lastSyncedAt` preservado;
  si es null, "sin datos aún").
- `partial` → "sync parcial · hace Xh".
- `ok` / `null` → "sync hace Xh" (comportamiento actual).

El botón Sync no cambia; offline falla rápido gracias al pre-check.

### 4. Auto-sync best-effort al abrir — `mobile/app/_layout.tsx`

Tras la DB lista y `loadLastSynced()`, disparar `useSyncStore.getState().sync()`
una vez, no bloqueante (sin `await` que trabe el render). En casa con server
arriba refresca solo; offline el pre-check corta enseguida y marca `offline`,
dejando el cache navegable. La app nunca cae en `EmptyState` si hubo un sync
previo.

## Testing

- **Unit** (`mobile/store/syncStore.test.ts` o `mobile/lib/sync.test.ts`):
  mockear `isServerReachable` y `performSync` y verificar la máquina de estados:
  - no reachable → `lastSyncStatus='offline'`, `lastSyncedAt` intacto.
  - `okCount===0` → `offline`, timestamp intacto.
  - `failCount>0, okCount>0` → `partial`, timestamp actualizado.
  - todo OK → `ok`, timestamp actualizado.
- **Manual**: con server up, Sync → datos y "sync recién". Bajar el server,
  reabrir la app / tocar Sync → "⚠ Sin conexión · datos de hace Xh", el
  timestamp no cambia, y todas las tabs siguen mostrando el cache.

## Fuera de alcance (YAGNI)

- Detección real de red con `expo-network`/netinfo (Enfoque B).
- Reintento automático al recuperar conexión.
- Sync en background.

## Nota de implementación

`mobile/AGENTS.md` exige leer los docs versionados de Expo v57
(https://docs.expo.dev/versions/v57.0.0/) antes de escribir código. Este diseño
no agrega APIs de Expo nuevas (usa `fetch` nativo), pero verificar igual antes de
tocar código.
