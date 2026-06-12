import axios from 'axios';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: number;
}

export interface JiraIssueRaw {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string;
  } | null;
  created_at: string;
  updated_at: string;
  transitions: Array<{ from_status: string; to_status: string; transitioned_at: string }>;
}

export class JiraClient {
  private auth: { username: string; password: string };

  constructor(private cfg: JiraConfig) {
    this.auth = { username: cfg.email, password: cfg.apiToken };
  }

  async fetchIssues(updatedSince?: string): Promise<JiraIssueRaw[]> {
    const results: JiraIssueRaw[] = [];
    let startAt = 0;
    const maxResults = 50;

    const jql = [
      `project = ${this.cfg.projectKey}`,
      updatedSince ? `updated >= "${updatedSince}"` : null,
    ].filter(Boolean).join(' AND ');

    while (true) {
      const { data } = await axios.get(
        `${this.cfg.baseUrl}/rest/agile/1.0/board/${this.cfg.boardId}/issue`,
        {
          auth: this.auth,
          params: { jql, startAt, maxResults, expand: 'changelog', fields: 'summary,description,status,assignee,created,updated' },
        }
      );

      for (const issue of data.issues) {
        results.push(this.mapIssue(issue));
      }

      if (startAt + data.issues.length >= data.total) break;
      startAt += maxResults;
    }

    return results;
  }

  private mapIssue(raw: any): JiraIssueRaw {
    const desc = raw.fields.description;
    const descText = desc?.content
      ?.flatMap((b: any) => b.content?.map((t: any) => t.text) ?? [])
      .join(' ') ?? '';

    const transitions = (raw.changelog?.histories ?? []).flatMap((h: any) =>
      h.items
        .filter((item: any) => item.field === 'status')
        .map((item: any) => ({
          from_status: item.fromString,
          to_status: item.toString,
          transitioned_at: h.created,
        }))
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
}

export function createJiraClient(): JiraClient {
  return new JiraClient({
    baseUrl: process.env.JIRA_BASE_URL!,
    email: process.env.JIRA_EMAIL!,
    apiToken: process.env.JIRA_API_TOKEN!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    boardId: Number(process.env.JIRA_BOARD_ID!),
  });
}
