# Portable Jira client — SP2 — design

**Date:** 2026-08-01
**Status:** approved (design)

## Context

Sub-proyecto 2 del objetivo mayor (mobile direct-to-Jira; ver
`2026-07-31-portable-metrics-core-sp1-design.md`). SP1 dejó `shared/core/` con el
motor de métricas puro. SP2 hace **portable el acceso a Jira**: parsear la
respuesta cruda de Jira (issues + changelog → transiciones) y el loop de
paginación, para que corran igual en el server (Node) y en el mobile (RN).

**Decisión confirmada:** transporte HTTP **inyectado**. La lógica compartida
(construir JQL, paginar, parsear) vive en el core; el `fetch` real lo provee cada
plataforma. Así el **server no cambia de comportamiento** (sigue con axios) y el
**mobile pega directo a Jira** en SP4 inyectando un transporte basado en `fetch`.
El mobile NO pasa por el server.

## Goal (SP2)

Extraer a `shared/core/jira.ts` el parseo puro (`parseJiraIssue`), la
construcción del JQL (`buildJql`) y el loop de paginación (`fetchBoardIssues`,
con transporte inyectado). Refactorizar `server/src/services/jira.ts` para
delegar en el core usando un transporte axios. **Sin cambio de comportamiento**
(el `jira.test.ts` del server pasa sin tocar) + tests unitarios nuevos del core.

## Arquitectura

### `shared/core/jira.ts` (puro; sin `axios`, sin `process.env`, sin Node built-ins)

```ts
export interface JiraConfig { baseUrl: string; email: string; apiToken: string; projectKey: string; boardId: number; }
export interface JiraIssueRaw {
  id: string; title: string; description: string; status: string;
  assignee: { id: string; display_name: string; email: string; avatar_url: string } | null;
  created_at: string; updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}
// Transporte inyectado: hace el GET y devuelve el JSON crudo de Jira.
export interface JiraHttpRequest { url: string; auth: { username: string; password: string }; params: Record<string, any>; }
export type JiraHttp = (req: JiraHttpRequest) => Promise<{ issues?: any[]; total?: number } & Record<string, any>>;
```

- `parseJiraIssue(raw: any): JiraIssueRaw` — port EXACTO de `mapIssue`
  (`server/src/services/jira.ts:75`): descripción ADF → texto plano
  (`content.flatMap(...).join(' ')`), changelog → transiciones (items con
  `field === 'status'`, usando `fromString`/`toString`/`h.created`), assignee
  (accountId/displayName/emailAddress/avatarUrls['48x48'] ?? null).
- `buildJql(projectKey: string, updatedSince?: string): string` — port EXACTO de
  la construcción actual: `project = {projectKey}` + (si `updatedSince`)
  `updated >= "{updatedSince.replace('T',' ').substring(0,16)}"`, unidos con ` AND `.
- `fetchBoardIssues(cfg: JiraConfig, http: JiraHttp, updatedSince?): Promise<JiraIssueRaw[]>`
  — loop de paginación EXACTO (maxResults 50, `startAt`, corta cuando
  `issues.length === 0 || startAt + issues.length >= total`). Arma
  `url = ${cfg.baseUrl}/rest/agile/1.0/board/${cfg.boardId}/issue`,
  `auth = { username: cfg.email, password: cfg.apiToken }`,
  `params = { jql, startAt, maxResults, expand: 'changelog', fields: 'summary,description,status,assignee,created,updated' }`,
  llama `http({url, auth, params})`, mapea `data.issues` con `parseJiraIssue`.
  No hace try/catch de errores de transporte — deja propagar (el transporte
  define el formato de error, ver abajo).

### `server/src/services/jira.ts` (fino)

- `axiosHttp: JiraHttp` — `({url, auth, params}) => axios.get(url, { auth, params }).then(r => r.data)`,
  envuelto en el try/catch actual que mapea el error de axios a
  `Jira API error${status ? ` (${status})` : ''}: ${msg}` (donde
  `msg = err.response?.data?.errorMessages?.join(', ') ?? err.message`). Esto
  **preserva el manejo de errores del server**.
- `class JiraClient` — `constructor(cfg)`, `readonly boardId`,
  `fetchIssues(updatedSince?) = fetchBoardIssues(this.cfg, axiosHttp, updatedSince)`.
  Mantiene la clase y la firma pública para no romper `sync.ts` ni el test.
- `createJiraClients()` — **sin cambios** (lee `process.env`, arma `JiraClient[]`).
- Reexporta `JiraIssueRaw` desde el core (para consumidores que lo importen de aquí).

## No behavior change + Testing

- **Gate de paridad:** `server/src/services/jira.test.ts` pasa **sin modificar**
  (mockea `axios`, verifica que `fetchIssues` llame a `axios.get(url, {auth, params})`
  con el board URL + `jql` y que mapee bien). Como `axiosHttp` hace exactamente
  `axios.get(url, {auth, params})`, el mock y las aserciones siguen válidos.
- **Tests nuevos del core** (`shared/core/jira.test.ts`, vitest):
  - `parseJiraIssue`: descripción ADF multi-bloque → texto; changelog con items
    de status (y no-status ignorados) → transiciones; assignee presente y null.
  - `buildJql`: con y sin `updatedSince` (formato de fecha recortado a 16 chars).
  - `fetchBoardIssues`: transporte fake que devuelve 2 páginas → concatena y
    corta bien; verifica url/params/auth pasados al transporte.

## Verificación

```bash
cd shared/core && npx vitest run          # tests nuevos verdes
cd server && npx vitest run               # 0 fallas; jira.test.ts sin tocar, verde
cd shared/core && npx tsc --noEmit
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

## Fuera de alcance (SP2)

- Transporte `fetch` del mobile + config desde secure-store (SP4).
- Clasificación con Gemini portable (SP3).
- Cualquier cambio en `sync.ts` más allá de que siga compilando/funcionando
  (usa `createJiraClients()`/`fetchIssues`, que no cambian de firma).

## Riesgos

- El error de axios tiene forma específica (`err.response?.status`,
  `err.response?.data?.errorMessages`); debe quedar en `axiosHttp` (server), no en
  el core. Mitigación: el gate de paridad + revisar que el core no importe axios.
