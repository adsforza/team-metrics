# SP4d: Direct-mode config (secure-store) + Ajustes UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `mobile/lib/directConfig.ts` (store direct-mode credentials in `expo-secure-store`, assemble the config `directSync` needs) and a "Jira directo" section in Ajustes to enter/save them.

**Architecture:** `getDirectConfig()` returns `{ boards: JiraConfig[]; geminiKey } | null`; SP5 will read it and call `directSync`. Config entry only here — no mode toggle/switch yet.

**Tech Stack:** TypeScript, `expo-secure-store` (native module), React Native, jest.

## Global Constraints

- `expo-secure-store` is a NATIVE module → after install, `cd ios && pod install` is required before the next device build (note in report; the CLI bundle-check doesn't need pods).
- Additive: new `directConfig.ts` + a new Ajustes section; don't change existing behavior.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lc4xHb78nrkRd6jPQTqt3Y
  ```
- Tests: `cd mobile && npm test`. Typecheck: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit`.

---

### Task 1: `directConfig` module (TDD)

**Files:** Install `expo-secure-store`; create `mobile/lib/directConfig.ts`, `mobile/__tests__/directConfig.test.ts`.

**Interfaces:** `DirectConfigFields`; `getDirectConfigFields()`, `setDirectConfigFields(fields)`, `getDirectConfig() → { boards: JiraConfig[]; geminiKey } | null`.

- [ ] **Step 1:** `cd mobile && npx expo install expo-secure-store` (adds the dep + native module).

- [ ] **Step 2: Write the failing test** `mobile/__tests__/directConfig.test.ts` (mock expo-secure-store with an in-memory map):

```ts
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    __store: store,
  };
});

import { getDirectConfigFields, setDirectConfigFields, getDirectConfig } from '../lib/directConfig';

describe('directConfig', () => {
  it('round-trips fields', async () => {
    await setDirectConfigFields({ baseUrl: 'https://x.atlassian.net/', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardIds: '7, 9', geminiKey: 'gk' });
    const f = await getDirectConfigFields();
    expect(f.email).toBe('e@t.com');
    expect(f.boardIds).toBe('7, 9');
  });

  it('getDirectConfig assembles boards (normalizing baseUrl) or null if incomplete', async () => {
    const cfg = await getDirectConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.geminiKey).toBe('gk');
    expect(cfg!.boards).toHaveLength(2);
    expect(cfg!.boards[0]).toEqual({ baseUrl: 'https://x.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 7 });
    // missing field → null
    await setDirectConfigFields({ geminiKey: '' } as any); // simulate missing key path is separate; use a fresh incomplete case:
  });
});
```
(Adjust the "incomplete → null" assertion to a clean case: e.g. a second describe that only sets some fields and expects `null`.)

- [ ] **Step 3: Run → RED.**

- [ ] **Step 4: Implement `mobile/lib/directConfig.ts`:**

```ts
import * as SecureStore from 'expo-secure-store';
import type { JiraConfig } from '@teammetrics/core/jira';

export interface DirectConfigFields {
  baseUrl: string; email: string; apiToken: string; projectKey: string; boardIds: string; geminiKey: string;
}

const FIELD_TO_KEY: Record<keyof DirectConfigFields, string> = {
  baseUrl: 'JIRA_BASE_URL', email: 'JIRA_EMAIL', apiToken: 'JIRA_API_TOKEN',
  projectKey: 'JIRA_PROJECT_KEY', boardIds: 'JIRA_BOARD_IDS', geminiKey: 'GEMINI_API_KEY',
};

export async function getDirectConfigFields(): Promise<Partial<DirectConfigFields>> {
  const out: Partial<DirectConfigFields> = {};
  for (const field of Object.keys(FIELD_TO_KEY) as (keyof DirectConfigFields)[]) {
    const v = await SecureStore.getItemAsync(FIELD_TO_KEY[field]);
    if (v != null) out[field] = v;
  }
  return out;
}

export async function setDirectConfigFields(fields: Partial<DirectConfigFields>): Promise<void> {
  for (const field of Object.keys(FIELD_TO_KEY) as (keyof DirectConfigFields)[]) {
    const v = fields[field];
    if (v !== undefined) await SecureStore.setItemAsync(FIELD_TO_KEY[field], String(v));
  }
}

export async function getDirectConfig(): Promise<{ boards: JiraConfig[]; geminiKey: string } | null> {
  const f = await getDirectConfigFields();
  if (!f.baseUrl || !f.email || !f.apiToken || !f.projectKey || !f.boardIds || !f.geminiKey) return null;
  const baseUrl = f.baseUrl.replace(/\/+$/, '');
  const boardIds = f.boardIds.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
  if (boardIds.length === 0) return null;
  const boards: JiraConfig[] = boardIds.map(boardId => ({
    baseUrl, email: f.email!, apiToken: f.apiToken!, projectKey: f.projectKey!, boardId,
  }));
  return { boards, geminiKey: f.geminiKey };
}
```

- [ ] **Step 5: Run → GREEN** (`cd mobile && npx jest __tests__/directConfig.test.ts`).

- [ ] **Step 6: Commit**
```bash
git add mobile/lib/directConfig.ts mobile/__tests__/directConfig.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): directConfig in expo-secure-store (getDirectConfig assembler)"
```

---

### Task 2: "Jira directo" section in Ajustes

**Files:** Modify `mobile/app/(tabs)/ajustes.tsx`.

- [ ] **Step 1:** Add state + load: `const [dc, setDc] = useState<Partial<DirectConfigFields>>({})`; in a `useEffect`, `getDirectConfigFields().then(setDc)`.

- [ ] **Step 2:** Add a section (after "Servidor") with a card of `TextInput`s bound to `dc` fields (`baseUrl`, `email`, `apiToken` → `secureTextEntry`, `projectKey`, `boardIds`, `geminiKey` → `secureTextEntry`), each `onChangeText={t => setDc(prev => ({ ...prev, <field>: t }))}`, `autoCapitalize="none"`, `autoCorrect={false}`. A "Guardar" button → `setDirectConfigFields(dc)` then `Alert.alert('Guardado')`. Reuse the existing `s.input`/`Card.base`/`s.sectionLabel` styles.

- [ ] **Step 3:** Typecheck + bundle sanity:
Run: `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
Run: `cd mobile && npx expo export --platform ios --output-dir /tmp/sp4d-ui` → `iOS Bundled` OK.

- [ ] **Step 4: Commit**
```bash
git add "mobile/app/(tabs)/ajustes.tsx"
git commit -m "feat(mobile): Ajustes 'Jira directo' section to enter direct-mode config"
```

---

### Task 3: Final verification

- [ ] **Step 1:** `cd mobile && npm test` → 0 failures.
- [ ] **Step 2:** `cd mobile && node node_modules/typescript/lib/tsc.js --noEmit` → no new errors.
- [ ] **Step 3:** Report that a device build needs `cd mobile/ios && pod install` first (secure-store native module).

---

## Self-Review

**Spec coverage:** `directConfig` (secure-store get/set + `getDirectConfig` assembler) → Task 1; Ajustes UI section → Task 2; secure-store native/pod-install note → Global Constraints + Task 3. ✓
**Type consistency:** `getDirectConfig → { boards: JiraConfig[]; geminiKey }` matches `directSync`'s config (minus filters, added in SP5). `JiraConfig` from `@teammetrics/core/jira`.
**Placeholder scan:** directConfig code inline; UI described with concrete field/handler guidance (component, manual-verified on device — no RN component test infra).
**Out of scope:** mode toggle/switch + calling directSync (SP5).
