export interface JiraConfig { baseUrl: string; email: string; apiToken: string; projectKey: string; boardId: number; }

export interface JiraIssueRaw {
  id: string; title: string; description: string; status: string;
  assignee: { id: string; display_name: string; email: string; avatar_url: string | null } | null;
  created_at: string; updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

export interface JiraHttpRequest { url: string; auth: { username: string; password: string }; params: Record<string, any>; }
export type JiraHttp = (req: JiraHttpRequest) => Promise<{ issues?: any[]; total?: number } & Record<string, any>>;

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
