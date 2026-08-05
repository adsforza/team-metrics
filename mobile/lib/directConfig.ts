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
