# Direct-mode config (secure-store) + Ajustes UI — SP4d — design

**Date:** 2026-08-04
**Status:** approved (design)

## Context

Sub-proyecto 4d del objetivo mayor (mobile direct-to-Jira). `directSync` (SP4c-3b) ya
existe y recibe `config = { boards: JiraConfig[]; geminiKey }` como parámetro. SP4d
provee ese config: **guardado seguro** de las credenciales (Jira token + Gemini key +
datos de conexión) y una **UI en Ajustes** para cargarlas. El **toggle de modo y el
switch** que efectivamente llaman a `directSync` son SP5.

## Goal (SP4d)

- `mobile/lib/directConfig.ts`: get/set de la config del direct mode en `expo-secure-store`,
  + `getDirectConfig()` que arma `{ boards: JiraConfig[]; geminiKey } | null`.
- Sección "Jira directo" en `ajustes.tsx` para cargar/guardar los campos.

## Arquitectura

### Dependencia
`expo-secure-store` (Keychain iOS) → `npx expo install expo-secure-store`.
**Es un módulo nativo** → tras instalarlo hay que correr `cd ios && pod install` antes del
próximo build de Xcode (a diferencia de `@google/generative-ai`, que era JS puro). El
bundle-check (`expo export`) no necesita pods; el run en device sí.

### `mobile/lib/directConfig.ts`
Claves en secure-store: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`,
`JIRA_BOARD_IDS` (coma-separado), `GEMINI_API_KEY`.
```ts
export interface DirectConfigFields { baseUrl: string; email: string; apiToken: string; projectKey: string; boardIds: string; geminiKey: string; }
export async function getDirectConfigFields(): Promise<Partial<DirectConfigFields>>;   // lee todas las claves
export async function setDirectConfigFields(fields: Partial<DirectConfigFields>): Promise<void>; // guarda las presentes
export async function getDirectConfig(): Promise<{ boards: JiraConfig[]; geminiKey: string } | null>;
```
`getDirectConfig`: si falta cualquiera de baseUrl/email/apiToken/projectKey/boardIds/geminiKey →
`null`. Si están todas: `boards` = un `JiraConfig` por cada id en `boardIds` (split por coma,
`Number`, filtrar inválidos), compartiendo baseUrl/email/apiToken/projectKey; `geminiKey`.
Normalizar `baseUrl` (quitar `/` final), como hace el server.

### UI en `ajustes.tsx`
Sección "Jira directo": `TextInput` para baseUrl, email, apiToken (`secureTextEntry`),
projectKey, boardIds, geminiKey (`secureTextEntry`); botón "Guardar" → `setDirectConfigFields`.
Cargar los valores actuales al montar (`getDirectConfigFields`), token/key enmascarados o
vacíos. Solo carga/guardado — sin toggle ni llamada a directSync (SP5).

## Testing

- **`directConfig`** (jest, mock `expo-secure-store` con un objeto en memoria):
  - set/get round-trip de los campos.
  - `getDirectConfig()` → `null` si falta un campo; con todos, arma `boards` correctos
    (múltiples board ids → múltiples JiraConfig), `geminiKey`, baseUrl normalizada.
- La **UI de Ajustes** se verifica en device (no hay infra de test de componentes RN acá).

## Verificación

```bash
cd mobile && npm test
cd mobile && node node_modules/typescript/lib/tsc.js --noEmit
cd mobile && npx expo export --platform ios --output-dir /tmp/sp4d-export   # bundle sanity
# device: cd ios && pod install ; luego rebuild en Xcode (por el módulo nativo secure-store)
```

## Fuera de alcance (SP4d)

- Toggle "usar direct mode" + switch backend↔direct + llamar a `directSync` desde el
  `syncStore`/reachability → SP5.
