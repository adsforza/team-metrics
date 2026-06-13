import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { runSync } from './sync';

vi.mock('./jira', () => ({
  createJiraClient: () => ({
    fetchIssues: vi.fn().mockResolvedValue([{
      id: 'OPS-1',
      title: 'Test issue',
      description: 'Some description',
      status: 'In Progress',
      assignee: { id: 'u1', display_name: 'User One', email: 'u@t.com', avatar_url: null },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      transitions: [
        { from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T00:00:00.000Z' },
      ],
    }]),
  }),
}));

vi.mock('./claude', () => ({
  classifyTalla: vi.fn().mockResolvedValue({ talla: 'M', confidence: 0.9, razon: 'test' }),
}));

describe('runSync', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
  });

  it('upserts issues and transitions into DB', async () => {
    const result = await runSync(db);
    expect(result.synced_count).toBe(1);
    expect(result.classified_count).toBe(1);

    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('OPS-1') as any;
    expect(issue).toBeTruthy();
    expect(issue.talla).toBe('M');
    expect(issue.status).toBe('In Progress');

    const transitions = db.prepare('SELECT * FROM transitions WHERE issue_id = ?').all('OPS-1');
    expect(transitions).toHaveLength(1);
  });

  it('writes a sync_log entry', async () => {
    await runSync(db);
    const log = db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get() as any;
    expect(log.synced_count).toBe(1);
    expect(log.error).toBeNull();
    expect(log.finished_at).toBeTruthy();
  });
});
