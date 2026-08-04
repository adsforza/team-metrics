import { loadCoreIssues, loadCoreTransitions, loadCoreMembers } from '../lib/db';

function stubDb(rowsBySql: (sql: string) => any[]) {
  const calls: string[] = [];
  const db: any = { getAllAsync: async (sql: string) => { calls.push(sql); return rowsBySql(sql); } };
  return { db, calls };
}

describe('core loaders', () => {
  it('loadCoreIssues selects the CoreIssueWithTitle columns and returns typed rows', async () => {
    const rows = [{ id: 'A', title: 'Issue A', status: 'In Progress', assignee_id: 'u1', talla: 'M', created_at: 'c', last_transition_at: 'l' }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreIssues(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM issues');
    expect(calls[0]).toMatch(/id, title, status, assignee_id, talla, created_at, last_transition_at/);
  });

  it('loadCoreTransitions selects transition columns', async () => {
    const rows = [{ issue_id: 'A', from_status: 'To Do', to_status: 'In Progress', transitioned_at: 't' }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreTransitions(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM transitions');
  });

  it('loadCoreMembers selects member columns ordered by display_name', async () => {
    const rows = [{ id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreMembers(db);
    expect(res).toEqual(rows);
    expect(calls[0]).toContain('FROM team_members');
    expect(calls[0]).toContain('ORDER BY display_name');
  });
});
