import { loadCoreIssues, loadCoreTransitions, loadCoreMembers } from '../lib/db';

function stubDb(rowsBySql: (sql: string) => any[]) {
  const calls: string[] = [];
  const db: any = { getAllAsync: async (sql: string) => { calls.push(sql); return rowsBySql(sql); } };
  return { db, calls };
}

describe('core loaders', () => {
  it('loadCoreIssues selects the CoreIssueWorkload columns and parses boards', async () => {
    const rows = [{
      id: 'A', title: 'Issue A', status: 'In Progress', assignee_id: 'u1', talla: 'M',
      created_at: 'c', last_transition_at: 'l',
      requester: 'Groot', priority: 'High (P1)', boards: '9534,9536',
    }];
    const { db, calls } = stubDb(() => rows);
    const res = await loadCoreIssues(db);
    expect(res[0].boards).toEqual([9534, 9536]);   // el CSV de la base se parsea a numeros
    expect(res[0].requester).toBe('Groot');
    expect(res[0].priority).toBe('High (P1)');
    expect(res[0].talla).toBe('M');                // el resto de las columnas pasa igual
    expect(calls[0]).toContain('FROM issues');
    expect(calls[0]).toMatch(/id, title, status, assignee_id, talla, created_at, last_transition_at/);
    expect(calls[0]).toMatch(/requester, priority, boards/);
  });

  it('loadCoreIssues devuelve boards vacio cuando la columna es NULL', async () => {
    // Estado real de casi todas las filas hasta que corra el backfill.
    const { db } = stubDb(() => [{
      id: 'A', title: 't', status: 'Backlog', assignee_id: null, talla: null,
      created_at: 'c', last_transition_at: null, requester: null, priority: null, boards: null,
    }]);
    const res = await loadCoreIssues(db);
    expect(res[0].boards).toEqual([]);
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
