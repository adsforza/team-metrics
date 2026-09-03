import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { runSync } from './sync';
import { classifyTalla } from './claude';

vi.mock('./jira', () => ({
  createJiraClients: () => [{
    boardId: 1,
    fetchIssues: vi.fn().mockResolvedValue([{
      id: 'OPS-1',
      title: 'Test issue',
      description: 'Some description',
      status: 'In Progress',
      assignee: { id: 'u1', display_name: 'User One', email: 'u@t.com', avatar_url: null },
      requester: null,
      priority: null,
      boards: [1],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      transitions: [
        { from_status: 'To Do', to_status: 'In Progress', transitioned_at: '2026-01-02T00:00:00.000Z' },
      ],
    }]),
    fetchBoardName: vi.fn().mockResolvedValue('Board Uno'),
  }],
}));

vi.mock('./claude', () => ({
  classifyTalla: vi.fn().mockResolvedValue({ talla: 'M', confidence: 0.9, razon: 'test' }),
}));

describe('runSync', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    vi.clearAllMocks();
  });

  it('downloads issues and transitions without classifying (new issues stay talla=null)', async () => {
    const result = await runSync(db);
    expect(result.synced_count).toBe(1);
    expect(result.classified_count).toBe(0);

    // Classification is decoupled: runSync must NOT call Gemini.
    expect(classifyTalla).not.toHaveBeenCalled();

    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get('OPS-1') as any;
    expect(issue).toBeTruthy();
    expect(issue.talla).toBeNull();            // unclassified → picked up later by /reclassify
    expect(issue.status).toBe('In Progress');

    const transitions = db.prepare('SELECT * FROM transitions WHERE issue_id = ?').all('OPS-1');
    expect(transitions).toHaveLength(1);
  });

  it('preserves an already-classified talla on re-sync', async () => {
    // First sync creates the issue with talla=null, then we classify it manually.
    await runSync(db);
    db.prepare(`UPDATE issues SET talla = 'L', talla_confidence = 0.8 WHERE id = 'OPS-1'`).run();

    // A second sync must not wipe the existing talla.
    await runSync(db);
    const issue = db.prepare('SELECT talla, talla_confidence FROM issues WHERE id = ?').get('OPS-1') as any;
    expect(issue.talla).toBe('L');
    expect(issue.talla_confidence).toBe(0.8);
  });

  it('writes a sync_log entry', async () => {
    await runSync(db);
    const log = db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get() as any;
    expect(log.synced_count).toBe(1);
    expect(log.error).toBeNull();
    expect(log.finished_at).toBeTruthy();
  });
});

const issueEn = (id: string, boards: number[]) => ({
  id, title: 'T', description: '', status: 'Backlog', assignee: null,
  requester: 'Tony Stack', priority: 'High (P1)', boards,
  created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
  transitions: [],
});

describe('runSync — carga de trabajo', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    applySchema(db);
    vi.resetModules();
    // DPP-1 esta en los dos boards; DPP-2 solo en 9536.
    vi.doMock('./jira', () => ({
      createJiraClients: () => [
        { boardId: 9534,
          fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9534])]),
          fetchBoardName: vi.fn().mockResolvedValue('Black Team Infra') },
        { boardId: 9536,
          fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9536]), issueEn('DPP-2', [9536])]),
          fetchBoardName: vi.fn().mockResolvedValue('Blue Team Infra') },
      ],
    }));
  });

  it('persiste requester, priority y la union de boards', async () => {
    const { runSync: run } = await import('./sync');
    await run(db);
    const a = db.prepare(`SELECT requester, priority, boards FROM issues WHERE id='DPP-1'`).get() as any;
    expect(a.requester).toBe('Tony Stack');
    expect(a.priority).toBe('High (P1)');
    expect(a.boards.split(',').map(Number).sort((x: number, y: number) => x - y)).toEqual([9534, 9536]);
    const b = db.prepare(`SELECT boards FROM issues WHERE id='DPP-2'`).get() as any;
    expect(b.boards).toBe('9536');
  });

  it('guarda el nombre de cada board en board_sync', async () => {
    const { runSync: run } = await import('./sync');
    await run(db);
    const rows = db.prepare(`SELECT board_id, name FROM board_sync ORDER BY board_id`).all() as any[];
    expect(rows).toEqual([
      { board_id: 9534, name: 'Black Team Infra' },
      { board_id: 9536, name: 'Blue Team Infra' },
    ]);
  });
});
