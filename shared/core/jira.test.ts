import { describe, it, expect } from 'vitest';
import { parseJiraIssue, buildJql, fetchBoardIssues, mergeIssuesByBoard } from './jira';
import type { JiraHttp } from './jira';

describe('parseJiraIssue', () => {
  const raw = {
    key: 'OPS-1',
    fields: {
      summary: 'Test issue',
      description: { content: [{ content: [{ text: 'hello' }, { text: 'world' }] }, { content: [{ text: 'again' }] }] },
      status: { name: 'In Progress' },
      assignee: { accountId: 'u1', displayName: 'User One', emailAddress: 'u@t.com', avatarUrls: { '48x48': 'http://img' } },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
    },
    changelog: { histories: [
      { created: '2026-01-02T10:00:00.000Z', items: [
        { field: 'status', fromString: 'To Do', toString: 'In Progress' },
        { field: 'assignee', fromString: null, toString: 'u1' }, // ignored (not status)
      ] },
    ] },
  };

  it('flattens ADF description, maps fields, derives status transitions, maps assignee', () => {
    const r = parseJiraIssue(raw);
    expect(r.id).toBe('OPS-1');
    expect(r.title).toBe('Test issue');
    expect(r.description).toBe('hello world again');
    expect(r.status).toBe('In Progress');
    expect(r.assignee).toEqual({ id: 'u1', display_name: 'User One', email: 'u@t.com', avatar_url: 'http://img' });
    expect(r.transitions).toEqual([{ from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T10:00:00.000Z' }]);
  });

  it('handles null assignee and empty/absent description & changelog', () => {
    const r = parseJiraIssue({ key: 'OPS-2', fields: { summary: 'x', description: null, status: { name: 'To Do' }, assignee: null, created: 'c', updated: 'u' } });
    expect(r.assignee).toBeNull();
    expect(r.description).toBe('');
    expect(r.transitions).toEqual([]);
  });
});

describe('buildJql', () => {
  it('project only when no updatedSince', () => {
    expect(buildJql('OPS')).toBe('project = OPS');
  });
  it('adds updated filter trimmed to 16 chars with space', () => {
    expect(buildJql('OPS', '2026-01-01T00:00:00.000Z')).toBe('project = OPS AND updated >= "2026-01-01 00:00"');
  });
});

const cfg = { baseUrl: 'https://t.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 7 };
const mkIssue = (k: string) => ({ key: k, fields: { summary: k, description: null, status: { name: 'To Do' }, assignee: null, created: 'c', updated: 'u' } });

describe('fetchBoardIssues', () => {
  it('paginates across pages and maps results; passes url/auth/params to transport', async () => {
    const calls: any[] = [];
    const http: JiraHttp = async (req) => {
      calls.push(req);
      if (req.params.startAt === 0) return { issues: [mkIssue('OPS-1'), mkIssue('OPS-2')], total: 3 };
      return { issues: [mkIssue('OPS-3')], total: 3 };
    };
    const res = await fetchBoardIssues(cfg, http, undefined);
    expect(res.map(r => r.id)).toEqual(['OPS-1', 'OPS-2', 'OPS-3']);
    expect(calls[0].url).toBe('https://t.atlassian.net/rest/agile/1.0/board/7/issue');
    expect(calls[0].auth).toEqual({ username: 'e@t.com', password: 'tok' });
    expect(calls[0].params).toMatchObject({ jql: 'project = OPS', startAt: 0, maxResults: 50, expand: 'changelog' });
    expect(calls[1].params.startAt).toBe(50);
  });

  it('stops on empty page and forwards updatedSince into jql', async () => {
    const http: JiraHttp = async () => ({ issues: [], total: 0 });
    const spy: any[] = [];
    const wrapped: JiraHttp = async (req) => { spy.push(req); return http(req); };
    const res = await fetchBoardIssues(cfg, wrapped, '2026-01-01T00:00:00.000Z');
    expect(res).toEqual([]);
    expect(spy[0].params.jql).toContain('updated >=');
  });
});

const rawIssue = (over: any = {}) => ({
  key: 'DPP-1',
  fields: {
    summary: 'Titulo', description: null, status: { name: 'Backlog' }, assignee: null,
    created: '2026-01-01T00:00:00.000-0300', updated: '2026-01-02T00:00:00.000-0300',
    priority: { name: 'High (P1)' },
    customfield_13510: [{ value: 'Tony Stack' }],
    ...over,
  },
  changelog: { histories: [] },
});

describe('parseJiraIssue — requester/priority/boards', () => {
  it('extrae requester del customfield_13510 y la prioridad', () => {
    const r = parseJiraIssue(rawIssue());
    expect(r.requester).toBe('Tony Stack');
    expect(r.priority).toBe('High (P1)');
  });

  it('deja requester y priority en null cuando Jira no los trae', () => {
    const r = parseJiraIssue(rawIssue({ customfield_13510: null, priority: null }));
    expect(r.requester).toBeNull();
    expect(r.priority).toBeNull();
  });

  it('acepta el customfield como objeto, no solo como array', () => {
    const r = parseJiraIssue(rawIssue({ customfield_13510: { value: 'Groot' } }));
    expect(r.requester).toBe('Groot');
  });

  it('devuelve boards vacio: la procedencia la agrega fetchBoardIssues', () => {
    expect(parseJiraIssue(rawIssue()).boards).toEqual([]);
  });
});

describe('mergeIssuesByBoard', () => {
  const mk = (id: string, boards: number[]) => ({ ...parseJiraIssue(rawIssue()), id, boards } as any);

  it('dedupea por id y hace la union de boards', () => {
    const out = mergeIssuesByBoard([[mk('DPP-1', [9534])], [mk('DPP-1', [9536]), mk('DPP-2', [9536])]]);
    expect(out).toHaveLength(2);
    expect(out.find(i => i.id === 'DPP-1')!.boards.sort()).toEqual([9534, 9536]);
    expect(out.find(i => i.id === 'DPP-2')!.boards).toEqual([9536]);
  });

  it('no duplica un board repetido', () => {
    const out = mergeIssuesByBoard([[mk('DPP-1', [9534])], [mk('DPP-1', [9534])]]);
    expect(out[0].boards).toEqual([9534]);
  });

  it('con un solo array devuelve lo mismo', () => {
    expect(mergeIssuesByBoard([[mk('DPP-9', [9534])]])).toHaveLength(1);
  });
});
