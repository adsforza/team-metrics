import axios from 'axios';
import { fetchBoardIssues } from '../../../shared/core/jira';
import type { JiraConfig, JiraIssueRaw, JiraHttp } from '../../../shared/core/jira';

export type { JiraIssueRaw };

const axiosHttp: JiraHttp = async ({ url, auth, params }) => {
  try {
    const { data } = await axios.get(url, { auth, params });
    return data;
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.errorMessages?.join(', ') ?? err.message;
    throw new Error(`Jira API error${status ? ` (${status})` : ''}: ${msg}`);
  }
};

export class JiraClient {
  readonly boardId: number;
  constructor(private cfg: JiraConfig) { this.boardId = cfg.boardId; }
  fetchIssues(updatedSince?: string): Promise<JiraIssueRaw[]> {
    return fetchBoardIssues(this.cfg, axiosHttp, updatedSince);
  }
  async fetchBoardName(): Promise<string | null> {
    try {
      const data = await axiosHttp({
        url: `${this.cfg.baseUrl}/rest/agile/1.0/board/${this.cfg.boardId}`,
        auth: { username: this.cfg.email, password: this.cfg.apiToken }, params: {},
      });
      return (data as any)?.name ?? null;
    } catch { return null; }   // el nombre es cosmetico: no debe romper el sync
  }
}

export function createJiraClients(): JiraClient[] {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'] as const;
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }
  const raw = process.env.JIRA_BOARD_IDS ?? process.env.JIRA_BOARD_ID ?? '';
  const boardIds = raw.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
  if (boardIds.length === 0) throw new Error('Set JIRA_BOARD_IDS (comma-separated board IDs) in .env');

  return boardIds.map(boardId => new JiraClient({
    baseUrl: process.env.JIRA_BASE_URL!,
    email: process.env.JIRA_EMAIL!,
    apiToken: process.env.JIRA_API_TOKEN!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    boardId,
  }));
}
