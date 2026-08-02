import { describe, it, expect } from 'vitest';
import { parseJiraIssue, buildJql } from './jira';

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
