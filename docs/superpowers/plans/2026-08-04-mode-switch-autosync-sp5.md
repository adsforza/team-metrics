# SP5: Mode switch + auto-sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire `directSync` into `syncStore.sync()` with a backend↔direct↔offline mode switch, expose `lastSyncMode` (+ header indicator), and auto-sync on app foreground + a 15-min interval.

**Architecture:** `sync()` prefers backend (`performSync`) when reachable, else direct (`directSync`) when config exists, else offline. Both write the same snapshot tables (reconciliation is automatic). Auto-sync triggers live in `_layout.tsx`; `sync()`'s `loading` guard + reachability pre-check keep them cheap.

**Tech Stack:** TypeScript, Zustand, React Native `AppState`, jest.

## Global Constraints

- Backend mode behavior unchanged when reachable (performSync path identical).
- Direct mode only when NOT reachable AND `getDirectConfig()` returns non-null.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: Mode switch in `syncStore` (TDD)

**Files:** Modify `mobile/store/syncStore.ts`; extend `mobile/__tests__/syncStore.test.ts`.

**Interfaces:** add `lastSyncMode: 'backend' | 'direct' | null` to `SyncState`. `sync()` selects backend/direct/offline.

- [ ] **Step 1: Extend `mobile/__tests__/syncStore.test.ts`** — additionally `jest.mock('../lib/directConfig')` and `jest.mock('../lib/directSync')` and `jest.mock('../lib/db', () => ({ getDb: jest.fn().mockResolvedValue({}) }))`. New cases:
  - reachable → `performSync` called, `directSync` NOT called, `lastSyncMode==='backend'`.
  - not reachable + `getDirectConfig` resolves a cfg → `directSync` called with `{ boards, geminiKey, filters }`, `performSync` NOT called, `lastSyncMode==='direct'`, status mapped from its result.
  - not reachable + `getDirectConfig` resolves `null` → `lastSyncStatus==='offline'`, neither called.
  Keep the existing cases working (they may need the new mocks added).

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Rewrite `sync()` in `mobile/store/syncStore.ts`:**

```ts
import { getDirectConfig } from '../lib/directConfig';
import { directSync } from '../lib/directSync';
import { getDb } from '../lib/db';
// ...existing imports (performSync, isServerReachable, dateRangeFor, useFilterStore)...

export type SyncMode = 'backend' | 'direct' | null;
// add to SyncState: lastSyncMode: SyncMode;  (initial: null)

sync: async () => {
  if (get().loading) return;
  set({ loading: true, errors: [] });
  const { timeRange, assignee } = useFilterStore.getState();
  const range = dateRangeFor(timeRange);
  try {
    let result; let mode: SyncMode;
    if (await isServerReachable()) {
      result = await performSync(range, assignee);
      mode = 'backend';
    } else {
      const cfg = await getDirectConfig();
      if (!cfg) { set({ loading: false, lastSyncStatus: 'offline' }); return; }
      const db = await getDb();
      result = await directSync(db, { boards: cfg.boards, geminiKey: cfg.geminiKey, filters: { from: range.from, to: range.to, assignee } });
      mode = 'direct';
    }
    const status = result.okCount === 0 ? 'offline' : result.failCount > 0 ? 'partial' : 'ok';
    set({
      loading: false,
      lastSyncStatus: status,
      lastSyncMode: mode,
      lastSyncedAt: result.okCount > 0 ? result.syncedAt : get().lastSyncedAt,
      errors: result.errors,
      dataVersion: get().dataVersion + 1,
    });
  } catch (err) {
    set({ loading: false, lastSyncStatus: 'offline', errors: [{ endpoint: 'global', message: String(err) }] });
  }
},
```
(Adjust `filters` shape to whatever `directSync`/`computeBundle` expect — `{ from?, to?, assignee? }`. `dateRangeFor` returns `{ from, to }`.)

- [ ] **Step 4: Run → GREEN** (`cd mobile && npx jest __tests__/syncStore.test.ts`).

- [ ] **Step 5: Commit**
```bash
git add mobile/store/syncStore.ts mobile/__tests__/syncStore.test.ts
git commit -m "feat(mobile): sync mode switch backend/direct/offline + lastSyncMode"
```

---

### Task 2: Mode indicator in the header (TDD)

**Files:** Modify `mobile/lib/syncStatus.ts` + `mobile/components/SyncHeader.tsx`; extend `mobile/__tests__/syncStatus.test.ts`.

- [ ] **Step 1:** Extend `syncStatusText(status, lastSyncedAt, now?)` → `syncStatusText(status, lastSyncedAt, mode?, now?)` (add `mode: 'backend'|'direct'|null`), appending `' · directo'` when `mode === 'direct'` and `status !== 'offline'`. Add a test case. RED then GREEN. Keep existing signatures working (mode optional).
- [ ] **Step 2:** In `SyncHeader.tsx`, pass `lastSyncMode` from the store to `syncStatusText`.
- [ ] **Step 3:** `cd mobile && npx jest __tests__/syncStatus.test.ts` → GREEN; `node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
- [ ] **Step 4: Commit**
```bash
git add mobile/lib/syncStatus.ts mobile/components/SyncHeader.tsx mobile/__tests__/syncStatus.test.ts
git commit -m "feat(mobile): header shows 'directo' when last sync used direct mode"
```

---

### Task 3: Auto-sync (AppState + interval)

**Files:** Modify `mobile/app/_layout.tsx`.

- [ ] **Step 1:** Add a `useEffect` (alongside the existing on-open sync):
```ts
useEffect(() => {
  const sub = AppState.addEventListener('change', s => { if (s === 'active') useSyncStore.getState().sync(); });
  const id = setInterval(() => { useSyncStore.getState().sync(); }, 15 * 60 * 1000);
  return () => { sub.remove(); clearInterval(id); };
}, []);
```
(`import { AppState } from 'react-native';`.) `sync()` self-guards via `loading` + reachability pre-check.

- [ ] **Step 2:** Typecheck + bundle: `node node_modules/typescript/lib/tsc.js --noEmit` → clean; `npx expo export --platform ios --output-dir /tmp/sp5-ui` → `iOS Bundled` OK.

- [ ] **Step 3: Commit**
```bash
git add "mobile/app/_layout.tsx"
git commit -m "feat(mobile): auto-sync on foreground + 15-min interval"
```

---

### Task 4: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures.
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
- [ ] **Step 3:** `cd mobile && npx expo export --platform ios --output-dir /tmp/sp5-export` → `iOS Bundled` OK.
- [ ] **Step 4:** Report the device steps: `cd mobile/ios && pod install` → Xcode rebuild → enter config in Ajustes → test airplane mode (direct) / backend up (backend).

---

## Self-Review

**Spec coverage:** mode switch backend/direct/offline + `lastSyncMode` (Task 1); header indicator (Task 2); auto-sync AppState+interval (Task 3); verification + device steps (Task 4). ✓
**Type consistency:** `sync()` maps both `performSync`/`directSync` results (same `{success,errors,syncedAt,okCount,failCount}` shape) uniformly; `directSync` config `{ boards, geminiKey, filters }` matches SP4c-3b + SP4d.
**Placeholder scan:** sync() rewrite is inline; header/`_layout` changes are concrete. Auto-sync verified via bundle + device (component/timers, no unit-test infra).
**Out of scope:** netinfo real connectivity; cleanup of deferred Minors.
