import { upsertRawIssues, getBoardLastSync, setBoardLastSync } from '../lib/db';
import type { JiraIssueRaw } from '@teammetrics/core/jira';

function stubDb() {
  const runs: { sql: string; args: any[] }[] = [];
  const db: any = {
    withTransactionAsync: async (fn: () => Promise<void>) => { await fn(); },
    runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
    getFirstAsync: async (_sql: string, _args: any[] = []) => null, // nothing exists yet
  };
  return { db, runs };
}

const issue = (over: Partial<JiraIssueRaw> = {}): JiraIssueRaw => ({
  id: 'OPS-1', title: 'T', description: 'D', status: 'In Progress',
  assignee: { id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null },
  created_at: 'c', updated_at: 'u',
  transitions: [
    { from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T00:00:00Z' },
    { from_status: 'In Progress', to_status: 'Done', transitioned_at: '2026-01-05T00:00:00Z' },
  ],
  ...over,
});

describe('upsertRawIssues', () => {
  it('upserts team member, issue (last_transition_at = max), and transitions; issue upsert never touches talla', async () => {
    const { db, runs } = stubDb();
    await upsertRawIssues(db, [issue()]);
    const memberSql = runs.find(r => r.sql.includes('team_members'));
    expect(memberSql).toBeTruthy();
    const issueSql = runs.find(r => r.sql.includes('INTO issues'));
    expect(issueSql).toBeTruthy();
    expect(issueSql!.sql).not.toMatch(/talla/);              // does NOT insert or update talla
    expect(issueSql!.args).toContain('2026-01-05T00:00:00Z'); // last_transition_at = max
    const tRuns = runs.filter(r => r.sql.includes('INTO transitions'));
    expect(tRuns).toHaveLength(2);
  });

  it('does not re-insert an existing transition (dedup via getFirstAsync)', async () => {
    const runs: { sql: string; args: any[] }[] = [];
    const db: any = {
      withTransactionAsync: async (fn: any) => { await fn(); },
      runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
      getFirstAsync: async () => ({ id: 1 }), // pretend every transition already exists
    };
    await upsertRawIssues(db, [issue()]);
    expect(runs.filter(r => r.sql.includes('INTO transitions'))).toHaveLength(0);
  });

  it('skips team_members upsert when assignee is null', async () => {
    const { db, runs } = stubDb();
    await upsertRawIssues(db, [issue({ assignee: null })]);
    expect(runs.find(r => r.sql.includes('team_members'))).toBeUndefined();
  });
});

describe('board_sync', () => {
  it('get returns stored value; set upserts', async () => {
    const runs: { sql: string; args: any[] }[] = [];
    const db: any = {
      runAsync: async (sql: string, args: any[] = []) => { runs.push({ sql, args }); },
      getFirstAsync: async () => ({ last_synced_at: '2026-01-01T00:00:00Z' }),
    };
    expect(await getBoardLastSync(db, 7)).toBe('2026-01-01T00:00:00Z');
    await setBoardLastSync(db, 7, '2026-02-02T00:00:00Z');
    const setSql = runs.find(r => r.sql.includes('board_sync'));
    expect(setSql!.args).toEqual([7, '2026-02-02T00:00:00Z']);
  });
});
