import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

import { JiraClient } from './jira';

const cfg = {
  baseUrl: 'https://test.atlassian.net',
  email: 'test@test.com',
  apiToken: 'token123',
  projectKey: 'OPS',
  boardId: 1,
};

describe('JiraClient', () => {
  let client: JiraClient;

  beforeEach(() => {
    client = new JiraClient(cfg);
    vi.clearAllMocks();
  });

  it('fetchIssues returns mapped issues', async () => {
    mockedAxios.get = vi.fn().mockResolvedValueOnce({
      data: {
        issues: [{
          key: 'OPS-1',
          fields: {
            summary: 'Test issue',
            description: { content: [] },
            status: { name: 'In Progress' },
            assignee: { accountId: 'user1', displayName: 'User One', emailAddress: 'u@t.com', avatarUrls: { '48x48': 'http://img' } },
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-02T00:00:00.000Z',
          },
          changelog: { histories: [] },
        }],
        total: 1,
        maxResults: 50,
        startAt: 0,
      }
    });

    const result = await client.fetchIssues();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('OPS-1');
    expect(result[0].status).toBe('In Progress');
    expect(result[0].assignee?.id).toBe('user1');
  });

  it('fetchIssues filters by updatedSince', async () => {
    mockedAxios.get = vi.fn().mockResolvedValueOnce({ data: { issues: [], total: 0, maxResults: 50, startAt: 0 } });
    await client.fetchIssues('2026-01-01T00:00:00.000Z');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/rest/agile/1.0/board/1/issue'),
      expect.objectContaining({ params: expect.objectContaining({ jql: expect.stringContaining('updated') }) })
    );
  });
});
