# SP-D: Mobile — progreso visible del sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que durante el sync el celu muestre en qué paso está ("Bajando métricas…", "Clasificando lote 3/8", "Calculando…", "Bajando novedades…") en vez de sólo la ruedita, para ver si está funcionando.

**Architecture:** Un tipo `SyncProgress`/`ProgressFn` en un módulo propio (`mobile/lib/progress.ts`) para no crear ciclos de import. Los orquestadores (`performSync`, `directSync`, `directReclassify`) reciben un `onProgress?` opcional y lo llaman en cada paso. `syncStore` guarda `progress: SyncProgress | null`, lo actualiza vía el callback y lo limpia al terminar. La UI (`SyncHeader`, `ajustes.tsx`) muestra `progress.label` (+ una barra fina si hay `current`/`total`) mientras `loading`.

**Tech Stack:** Expo/React Native + TypeScript; Jest (expo-sqlite y fetch mockeados).

## Global Constraints

- `onProgress` es **opcional** en todos lados (`onProgress?: ProgressFn`): nada se rompe si no se pasa. Los tests existentes que llaman `performSync()`/`directSync(...)` sin él siguen verdes.
- El progreso NO cambia el resultado del sync (okCount/failCount/errors intactos); es puramente informativo.
- `syncStore.progress` arranca en `null` y vuelve a `null` al terminar el sync (éxito, early-return o catch).
- La UI no tiene tests de componente en este repo → Task 2 se verifica con tsc + suite verde (ignorar sólo el error pre-existente de `TabHeader`/`@react-navigation/bottom-tabs`).

---

### Task 1: tipo `SyncProgress` + `onProgress` en orquestadores + estado en `syncStore`

**Files:**
- Create: `mobile/lib/progress.ts`
- Modify: `mobile/lib/sync.ts` (`performSync` acepta y emite `onProgress`)
- Modify: `mobile/lib/directSync.ts` (`directSync` y `directReclassify` emiten via `deps.onProgress`; `classifyAllPending` recibe onProgress)
- Modify: `mobile/store/syncStore.ts` (estado `progress` + cableado + limpieza)
- Test: `mobile/__tests__/sync.test.ts`, `mobile/__tests__/directSync.test.ts`, `mobile/__tests__/syncStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // mobile/lib/progress.ts
  export interface SyncProgress { label: string; current?: number; total?: number }
  export type ProgressFn = (p: SyncProgress) => void;
  ```
  - `performSync(dateParams?, assignee?, onProgress?: ProgressFn)`
  - `directSync(db, config, deps)` con `deps.onProgress?: ProgressFn`
  - `directReclassify(db, config, deps)` con `deps.onProgress?: ProgressFn`
  - `syncStore` state: `progress: SyncProgress | null`

- [ ] **Step 1: Escribir tests (fallan)**

`mobile/__tests__/sync.test.ts` — agregar dentro del `describe('performSync', ...)`:
```ts
test('reporta progreso via onProgress', async () => {
  mockAllFetch();
  const onProgress = jest.fn();
  await performSync(undefined, undefined, onProgress);
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('métricas') }));
});
```

`mobile/__tests__/directSync.test.ts` — agregar un test que pase `onProgress` en `deps` y verifique que se llama con un label de board (seguir el patrón del archivo para stubear `getRawSince`/`readUnclassifiedIssues`/`loadCore*` con valores mínimos y un `http` inyectado que devuelva `{ issues: [], total: 0 }`):
```ts
test('reporta progreso por board via deps.onProgress', async () => {
  (getRawSince as jest.Mock).mockResolvedValue(undefined);
  (readUnclassifiedIssues as jest.Mock).mockResolvedValue([]);
  (loadCoreIssues as jest.Mock).mockResolvedValue([]);
  (loadCoreTransitions as jest.Mock).mockResolvedValue([]);
  (loadCoreMembers as jest.Mock).mockResolvedValue([]);
  const http = jest.fn().mockResolvedValue({ issues: [], total: 0 });
  const onProgress = jest.fn();
  const config: DirectSyncConfig = { boards: [boardCfg], geminiKey: 'gk', filters: {} };
  await directSync(dbStub, config, { http, now: NOW, onProgress });
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('board') }));
});
```

`mobile/__tests__/syncStore.test.ts` — agregar:
```ts
test('sync pasa un onProgress a performSync y limpia progress al terminar', async () => {
  (isServerReachable as jest.Mock).mockResolvedValue(true);
  (performSync as jest.Mock).mockImplementation((_d: unknown, _a: unknown, onProgress?: (p: unknown) => void) => {
    onProgress?.({ label: 'Bajando métricas…' });
    return Promise.resolve({ success: true, errors: [], syncedAt: 'NOW', okCount: 5, failCount: 0 });
  });
  await useSyncStore.getState().sync();
  const s = useSyncStore.getState();
  expect(performSync).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Function));
  expect(s.progress).toBe(null);
});
```

- [ ] **Step 2: Correr → fallan**

Run: `cd mobile && npx jest sync.test.ts directSync.test.ts syncStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Crear `mobile/lib/progress.ts`**

```ts
export interface SyncProgress { label: string; current?: number; total?: number }
export type ProgressFn = (p: SyncProgress) => void;
```

- [ ] **Step 4: `performSync` emite progreso (mobile/lib/sync.ts)**

Importar el tipo: `import type { ProgressFn } from './progress';`. Cambiar la firma:
```ts
export async function performSync(dateParams?: { from: string; to: string }, assignee?: string | null, onProgress?: ProgressFn): Promise<SyncResult> {
```
Emitir:
- Antes del `Promise.allSettled` de snapshots: `onProgress?.({ label: 'Bajando métricas…' });`
- Antes del bloque de push de tallas (SP-B): `onProgress?.({ label: 'Enviando tallas…' });`
- Antes del bloque de pull de crudo (SP-C): `onProgress?.({ label: 'Bajando novedades…' });`

- [ ] **Step 5: `directSync`/`directReclassify` emiten progreso (mobile/lib/directSync.ts)**

Importar: `import type { ProgressFn } from './progress';`. Agregar a `DirectSyncDeps`:
```ts
export interface DirectSyncDeps {
  http?: JiraHttp;
  makeGen?: (key: string) => GenerateFn;
  now?: Date;
  onProgress?: ProgressFn;
}
```
En `directSync`, tomar `const onProgress = deps.onProgress;` y cambiar el loop de boards a index para reportar:
```ts
for (let bi = 0; bi < config.boards.length; bi++) {
  const boardCfg = config.boards[bi];
  onProgress?.({ label: `Bajando board ${bi + 1}/${config.boards.length}`, current: bi + 1, total: config.boards.length });
  try {
    const since = await getRawSince(db, boardCfg.boardId);
    // ...resto igual...
```
Pasar `onProgress` a `classifyAllPending` (nuevo parámetro) y, antes de `recomputeSnapshots`, emitir `onProgress?.({ label: 'Calculando…' });`. En `directReclassify` hacer lo mismo: pasar `deps.onProgress` a `classifyAllPending` y emitir `'Calculando…'` antes del recompute.

En `classifyAllPending`, agregar parámetro `onProgress?: ProgressFn` y dentro del loop de batches:
```ts
for (let i = 0; i < batches.length; i++) {
  onProgress?.({ label: `Clasificando lote ${i + 1}/${batches.length}`, current: i + 1, total: batches.length });
  // ...resto igual...
```

- [ ] **Step 6: `syncStore` — estado `progress` + cableado + limpieza (mobile/store/syncStore.ts)**

Importar `import type { SyncProgress } from '../lib/progress';`. Agregar a la interfaz `SyncState`: `progress: SyncProgress | null;`. En el `create(...)` inicial: `progress: null,`.

En `sync()`:
- Definir `const onProgress = (p: SyncProgress) => set({ progress: p });`
- `performSync(range, assignee, onProgress)` y `directSync(db, { ... }, { ..., onProgress })` (agregar `onProgress` al deps de directSync).
- En el `set({ loading:false, ... })` final agregar `progress: null`.
- En el `catch` agregar `progress: null`.
- En los early-returns (`!cfg`) agregar `progress: null` al set.

En `reclassify()`: pasar `onProgress` (mismo `const onProgress = ...`) al `directReclassify(db, { ... }, { onProgress })`, y limpiar `progress: null` en los `set({ loading:false })` de salida.

- [ ] **Step 7: Correr → pasan**

Run: `cd mobile && npx jest sync.test.ts directSync.test.ts syncStore.test.ts`
Expected: PASS.

- [ ] **Step 8: Suite completa + typecheck**

Run: `cd mobile && npx jest`
Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` (ignorar sólo el error pre-existente de `TabHeader`).
Expected: jest verde; sin errores nuevos de tsc.

- [ ] **Step 9: Commit**

```bash
git add mobile/lib/progress.ts mobile/lib/sync.ts mobile/lib/directSync.ts mobile/store/syncStore.ts mobile/__tests__/sync.test.ts mobile/__tests__/directSync.test.ts mobile/__tests__/syncStore.test.ts
git commit -m "feat(mobile): progreso de sync (onProgress + estado en store)"
```

---

### Task 2: UI muestra el progreso (SyncHeader + Ajustes)

**Files:**
- Modify: `mobile/components/SyncHeader.tsx`
- Modify: `mobile/app/(tabs)/ajustes.tsx`

**Interfaces:**
- Consumes: `useSyncStore().progress` (Task 1).

- [ ] **Step 1: `SyncHeader` muestra el label de progreso**

En `mobile/components/SyncHeader.tsx`, leer `progress` del store y, cuando `loading && progress`, mostrar `progress.label` en lugar del timestamp:
```tsx
const { sync, loading, lastSyncedAt, lastSyncStatus, lastSyncMode, progress } = useSyncStore();
const label = loading && progress ? progress.label : syncStatusText(lastSyncStatus, lastSyncedAt, lastSyncMode);
```
(El resto del componente igual; el `<Text>` ya muestra `label`.)

- [ ] **Step 2: `Ajustes` muestra progreso + barra**

En la card "Sincronización" de `mobile/app/(tabs)/ajustes.tsx`, leer `progress` del store (`const { sync, reclassify, loading, lastSyncedAt, progress } = useSyncStore();`) y, mientras `loading && progress`, mostrar debajo del row del botón una línea con `progress.label` y, si hay `current`/`total`, una barra fina:
```tsx
{loading && progress && (
  <View style={{ marginTop: 10 }}>
    <Text style={s.hint}>{progress.label}</Text>
    {progress.total ? (
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${Math.round((progress.current ?? 0) / progress.total * 100)}%` }]} />
      </View>
    ) : null}
  </View>
)}
```
Agregar los estilos:
```ts
progressTrack: { height: 4, backgroundColor: Colors.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
```

- [ ] **Step 3: Typecheck + suite**

Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` (ignorar sólo el error pre-existente de `TabHeader`).
Run: `cd mobile && npx jest`
Expected: sin errores nuevos de tsc; jest verde (la UI no tiene tests de componente en este repo).

- [ ] **Step 4: Commit**

```bash
git add mobile/components/SyncHeader.tsx "mobile/app/(tabs)/ajustes.tsx"
git commit -m "feat(mobile): UI muestra progreso del sync (header + ajustes)"
```

## Verification

```bash
cd mobile && npx jest        # verde (previos + nuevos de Task 1)
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit   # sólo el error pre-existente de TabHeader
```

Verificación real: en el device, al tocar Sincronizar, el header/Ajustes deben mostrar los pasos ("Bajando métricas…", "Clasificando lote i/N", "Calculando…") en vez de sólo la ruedita.

## Archivos críticos

- `mobile/lib/progress.ts` — tipos SyncProgress/ProgressFn
- `mobile/lib/sync.ts`, `mobile/lib/directSync.ts` — emiten onProgress
- `mobile/store/syncStore.ts` — estado progress + limpieza
- `mobile/components/SyncHeader.tsx`, `mobile/app/(tabs)/ajustes.tsx` — muestran el progreso
