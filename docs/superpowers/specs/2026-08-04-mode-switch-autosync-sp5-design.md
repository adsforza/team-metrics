# Mode switch + auto-sync — SP5 — design

**Date:** 2026-08-04
**Status:** approved (design)

## Context

Sub-proyecto final del objetivo mayor (mobile direct-to-Jira). Todo el pipeline existe:
`directSync` (SP4c-3b) + config en secure-store (SP4d). SP5 lo **enchufa** al `syncStore`
con un switch de modo (backend cuando hay backend; directo cuando no, si hay config) y
agrega auto-sync cuando vuelve la conexión / la app vuelve a primer plano.

## Goal (SP5)

- Switch de modo en `syncStore.sync()`: backend (`performSync`) ↔ directo (`directSync`) ↔ offline.
- `lastSyncMode` en el store + indicador en `SyncHeader`.
- Auto-sync: al volver la app a primer plano (AppState) + reintento periódico (intervalo).

## Arquitectura

### `syncStore.sync()` (reescrito)
```
if (loading) return; set loading, clear errors.
if (await isServerReachable()) {
  result = await performSync(dateRangeFor(timeRange), assignee);   // modo backend (igual que hoy)
  mode = 'backend';
} else {
  cfg = await getDirectConfig();
  if (cfg) {
    result = await directSync(db, { ...cfg, filters: { ...dateRangeFor(timeRange), assignee } }); // modo directo
    mode = 'direct';
  } else {
    set offline; return;                                            // sin backend ni config
  }
}
// map result → lastSyncStatus (ok/partial/offline por okCount/errors), lastSyncedAt (si okCount>0),
// errors, dataVersion++, lastSyncMode = mode.
```
- **filters** del `filterStore` (`dateRangeFor(timeRange)`, `assignee`), como hoy.
- **Reconciliación**: automática — ambos escriben los mismos snapshot tables (`writeSnapshots`);
  cuando el backend vuelve, el próximo sync usa `performSync` y repuebla (backend = fuente de verdad).
- Nuevo campo del store: `lastSyncMode: 'backend' | 'direct' | null`.

### `SyncHeader` — indicador de modo
Cuando `lastSyncMode === 'direct'` y `lastSyncStatus !== 'offline'`, el texto muestra
"· directo" (p.ej. "sync hace 5m · directo"), para saber que la data salió de Jira directo.
Extender `syncStatusText` (o el header) con el `mode`.

### Auto-sync (en `mobile/app/_layout.tsx`)
Además del sync al abrir (ya existe), agregar en un `useEffect`:
- `AppState.addEventListener('change', s => { if (s === 'active') useSyncStore.getState().sync(); })`
- `setInterval(() => useSyncStore.getState().sync(), 15 * 60 * 1000)` (15 min).
- cleanup: `sub.remove()` + `clearInterval`.
`sync()` ya tiene guarda `if (loading) return` (no se solapan) y hace el pre-check barato cuando
está offline. En modo directo, el fetch es **incremental** (`board_sync` since) → re-syncs baratos;
la clasificación solo corre sobre `talla NULL` (best-effort, acotada por cuota). 15 min es un
intervalo razonable para no abusar de Jira/Gemini.

## Testing

- **`syncStore.test.ts`** (extendido; mock `isServerReachable`/`getDirectConfig`/`performSync`/`directSync`):
  - reachable → llama `performSync`, `lastSyncMode='backend'`.
  - !reachable + `getDirectConfig` devuelve cfg → llama `directSync` con `{...cfg, filters}`, `lastSyncMode='direct'`, mapea estado.
  - !reachable + `getDirectConfig` null → `lastSyncStatus='offline'`, no llama ninguno.
- **`syncStatus`/header** (si se toca la función pura): test del texto con `mode='direct'`.
- El auto-sync (AppState/interval en `_layout`) se verifica en device (componente; no hay infra de test).

## Verificación

```bash
cd mobile && npm test
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
cd mobile && npx expo export --platform ios --output-dir /tmp/sp5-export
# device: cd mobile/ios && pod install ; rebuild Xcode ; cargar config en Ajustes ; probar modo avión
```

## Fuera de alcance (SP5)

- Detección real de red con `expo-network`/netinfo (seguimos con reachability pre-check + AppState/interval).
- Limpieza de los Minors pendientes (dailyThroughput dup; okCount de directSync; makeGen por batch) —
  se pueden abordar aparte si molestan.
