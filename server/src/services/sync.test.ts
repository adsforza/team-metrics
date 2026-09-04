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
  // Los clients se arman una sola vez por test y el mock devuelve SIEMPRE las mismas
  // instancias, para poder inspeccionar con que argumentos se llamo a fetchIssues.
  let clients: Array<{ boardId: number; fetchIssues: any; fetchBoardName: any }>;

  beforeEach(async () => {
    db = new Database(':memory:');
    applySchema(db);
    vi.resetModules();
    // DPP-1 esta en los dos boards; DPP-2 solo en 9536.
    clients = [
      { boardId: 9534,
        fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9534])]),
        fetchBoardName: vi.fn().mockResolvedValue('Black Team Infra') },
      { boardId: 9536,
        fetchIssues: vi.fn().mockResolvedValue([issueEn('DPP-1', [9536]), issueEn('DPP-2', [9536])]),
        fetchBoardName: vi.fn().mockResolvedValue('Blue Team Infra') },
    ];
    vi.doMock('./jira', () => ({ createJiraClients: () => clients }));
  });

  it('persiste requester, priority y la union de boards', async () => {
    const { runSync: run } = await import('./sync');
    await run(db);
    const a = db.prepare(`SELECT requester, priority, boards FROM issues WHERE id='DPP-1'`).get() as any;
    expect(a.requester).toBe('Tony Stack');
    expect(a.priority).toBe('High (P1)');
    // String exacto, no re-ordenado: asi el test detecta si se dejara de ordenar.
    expect(a.boards).toBe('9534,9536');
    const b = db.prepare(`SELECT boards FROM issues WHERE id='DPP-2'`).get() as any;
    expect(b.boards).toBe('9536');
  });

  it('un board nuevo fuerza sync completo de todos los boards', async () => {
    // 9534 ya venia sincronizando; 9536 se agrega recien ahora. Si 9534 fuera
    // incremental, un issue compartido sin cambios volveria solo desde 9536 y el
    // ON CONFLICT le borraria el 9534.
    db.prepare(`INSERT INTO board_sync (board_id, last_synced_at) VALUES (9534, '2026-01-01T00:00:00.000Z')`).run();
    const { runSync: run } = await import('./sync');
    await run(db);
    for (const c of clients) {
      expect(c.fetchIssues).toHaveBeenCalledWith(undefined);   // full sync, no incremental
    }
  });

  it('con todas las marcas presentes sincroniza incremental', async () => {
    db.prepare(`INSERT INTO board_sync (board_id, last_synced_at) VALUES (9534, '2026-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO board_sync (board_id, last_synced_at) VALUES (9536, '2026-02-02T00:00:00.000Z')`).run();
    const { runSync: run } = await import('./sync');
    await run(db);
    expect(clients[0].fetchIssues).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z');
    expect(clients[1].fetchIssues).toHaveBeenCalledWith('2026-02-02T00:00:00.000Z');
  });

  it('agregar un board no le borra la procedencia a un issue compartido sin cambios', async () => {
    // El escenario de perdida de datos real. 9534 ya venia sincronizando y DPP-1
    // no cambio desde entonces, asi que en incremental ese board no lo devuelve.
    // Sin el full sync forzado, DPP-1 volveria solo desde 9536 y el ON CONFLICT
    // le borraria el 9534, sacandolo del squad Black en silencio.
    clients[0].fetchIssues = vi.fn().mockImplementation((updatedSince?: string) =>
      Promise.resolve(updatedSince ? [] : [issueEn('DPP-1', [9534])]));
    db.prepare(`INSERT INTO board_sync (board_id, last_synced_at) VALUES (9534, '2026-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO issues (id, title, description, status, created_at, updated_at, synced_at, boards)
                VALUES ('DPP-1','t','','Backlog','2026-01-01','2026-01-01','2026-01-01','9534')`).run();

    const { runSync: run } = await import('./sync');
    await run(db);

    const row = db.prepare(`SELECT boards FROM issues WHERE id='DPP-1'`).get() as any;
    expect(row.boards).toBe('9534,9536');
  });

  it('el ON CONFLICT refleja la membresia de la corrida, no la acumulada', async () => {
    // Ejerce la rama ON CONFLICT, que los tests de arriba nunca tocan (base fresca = INSERT).
    db.prepare(`INSERT INTO issues (id, title, description, status, created_at, updated_at, synced_at, boards, talla)
                VALUES ('DPP-1','t','','Backlog','2026-01-01','2026-01-01','2026-01-01','9534','L')`).run();
    const { runSync: run } = await import('./sync');
    await run(db);
    const row = db.prepare(`SELECT boards, talla FROM issues WHERE id='DPP-1'`).get() as any;
    expect(row.boards).toBe('9534,9536');   // la corrida lo trae de ambos
    expect(row.talla).toBe('L');            // y la talla sobrevive al conflicto
  });

  it('pide los nombres de todos los boards en paralelo, no de a uno', async () => {
    // El board 9536 solo puede terminar si el 9534 sigue pendiente: con un
    // `await c.fetchBoardName()` adentro del loop esto no avanza nunca.
    let resolve9534: (v: string) => void = () => {};
    clients[0].fetchBoardName = vi.fn(() => new Promise<string>(r => { resolve9534 = r; }));
    clients[1].fetchBoardName = vi.fn(async () => {
      resolve9534('Black Team Infra');
      return 'Blue Team Infra';
    });
    const { runSync: run } = await import('./sync');
    await run(db);
    const rows = db.prepare(`SELECT board_id, name FROM board_sync ORDER BY board_id`).all() as any[];
    expect(rows).toEqual([
      { board_id: 9534, name: 'Black Team Infra' },
      { board_id: 9536, name: 'Blue Team Infra' },
    ]);
  });

  it('si falla el nombre de un board no queda ninguna marca escrita', async () => {
    // Marcas divergentes = el sync siguiente va incremental con `updatedSince` distinto
    // por board y `boards=excluded.boards` le borra la procedencia a un issue compartido.
    // Por eso es todo o nada: ni siquiera se escribe la del board que si respondio.
    clients[1].fetchBoardName = vi.fn().mockRejectedValue(new Error('jira 500'));
    const { runSync: run } = await import('./sync');
    await expect(run(db)).rejects.toThrow('jira 500');
    expect(db.prepare(`SELECT board_id FROM board_sync`).all()).toEqual([]);
    const log = db.prepare(`SELECT error FROM sync_log ORDER BY id DESC LIMIT 1`).get() as any;
    expect(log.error).toBe('jira 500');
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
