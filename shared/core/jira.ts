export interface JiraConfig { baseUrl: string; email: string; apiToken: string; projectKey: string; boardId: number; }

export interface JiraIssueRaw {
  id: string; title: string; description: string; status: string;
  assignee: { id: string; display_name: string; email: string; avatar_url: string | null } | null;
  requester: string | null;
  priority: string | null;
  boards: number[];
  created_at: string; updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

export interface JiraHttpRequest { url: string; auth: { username: string; password: string }; params: Record<string, any>; }
export type JiraHttp = (req: JiraHttpRequest) => Promise<{ issues?: any[]; total?: number } & Record<string, any>>;

const REQUESTER_FIELD = 'customfield_13510';

// Los custom fields de tipo select llegan como objeto {value} o como array de objetos.
function optionValue(v: any): string | null {
  if (v == null) return null;
  const first = Array.isArray(v) ? v[0] : v;
  const s = first?.value ?? first?.name ?? null;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

export function parseJiraIssue(raw: any): JiraIssueRaw {
  const desc = raw.fields.description;
  const descText = desc?.content
    ?.flatMap((b: any) => b.content?.map((t: any) => t.text) ?? [])
    .join(' ') ?? '';

  const transitions = (raw.changelog?.histories ?? []).flatMap((h: any) =>
    h.items
      .filter((item: any) => item.field === 'status')
      .map((item: any) => ({ from_status: item.fromString, to_status: item.toString, transitioned_at: h.created }))
  );

  const assignee = raw.fields.assignee ? {
    id: raw.fields.assignee.accountId,
    display_name: raw.fields.assignee.displayName,
    email: raw.fields.assignee.emailAddress,
    avatar_url: raw.fields.assignee.avatarUrls?.['48x48'] ?? null,
  } : null;

  return {
    id: raw.key,
    title: raw.fields.summary,
    description: descText,
    status: raw.fields.status.name,
    assignee,
    requester: optionValue(raw.fields[REQUESTER_FIELD]),
    priority: raw.fields.priority?.name ?? null,
    boards: [],
    created_at: raw.fields.created,
    updated_at: raw.fields.updated,
    transitions,
  };
}

export function buildJql(projectKey: string, updatedSince?: string): string {
  return [
    `project = ${projectKey}`,
    updatedSince ? `updated >= "${updatedSince.replace('T', ' ').substring(0, 16)}"` : null,
  ].filter(Boolean).join(' AND ');
}

export async function fetchBoardIssues(cfg: JiraConfig, http: JiraHttp, updatedSince?: string): Promise<JiraIssueRaw[]> {
  const results: JiraIssueRaw[] = [];
  let startAt = 0;
  const maxResults = 50;
  const jql = buildJql(cfg.projectKey, updatedSince);
  const url = `${cfg.baseUrl}/rest/agile/1.0/board/${cfg.boardId}/issue`;
  const auth = { username: cfg.email, password: cfg.apiToken };

  while (true) {
    const data = await http({
      url, auth,
      params: { jql, startAt, maxResults, expand: 'changelog',
        fields: `summary,description,status,assignee,created,updated,priority,${REQUESTER_FIELD}` },
    });
    const issues: any[] = Array.isArray(data.issues) ? data.issues : [];
    const total: number = typeof data.total === 'number' ? data.total : 0;
    for (const issue of issues) results.push({ ...parseJiraIssue(issue), boards: [cfg.boardId] });
    if (issues.length === 0 || startAt + issues.length >= total) break;
    startAt += maxResults;
  }
  return results;
}

// Reemplaza al .flat() de sync.ts: un issue presente en varios boards aparece una
// sola vez, con la union de sus boards, en vez de que el segundo upsert pise al primero.
export function mergeIssuesByBoard(issueArrays: JiraIssueRaw[][]): JiraIssueRaw[] {
  const byId = new Map<string, JiraIssueRaw>();
  for (const arr of issueArrays) {
    for (const issue of arr) {
      const prev = byId.get(issue.id);
      if (!prev) { byId.set(issue.id, { ...issue, boards: [...issue.boards] }); continue; }
      for (const b of issue.boards) if (!prev.boards.includes(b)) prev.boards.push(b);
    }
  }
  return [...byId.values()];
}
