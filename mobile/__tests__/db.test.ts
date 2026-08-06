jest.mock('expo-sqlite', () => {
  const mockDb = {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn((fn: () => Promise<void>) => fn()),
  };
  return { openDatabaseAsync: jest.fn().mockResolvedValue(mockDb) };
});

import * as SQLite from 'expo-sqlite';
import { getDb, hasData, readPendingTallaPush, markTallasPushed, updateIssueTallas, upsertServerRaw, getRawSince } from '../lib/db';

describe('getDb', () => {
  test('opens database and runs schema migration', async () => {
    await getDb();
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('teammetrics.db');
  });
});

describe('hasData', () => {
  test('returns false when kpi_snapshot is empty', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce(null);
    const result = await hasData(db);
    expect(result).toBe(false);
  });

  test('returns true when kpi_snapshot has a row', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValueOnce({ id: 1 });
    const result = await hasData(db);
    expect(result).toBe(true);
  });
});

describe('talla_pushed helpers', () => {
  test('updateIssueTallas marca talla_pushed=0 al escribir', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await updateIssueTallas(db, new Map([['X', { talla: 'M', confidence: 0.9 }]]));
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('talla_pushed=0'),
      ['M', 0.9, 'X'],
    );
  });

  test('readPendingTallaPush consulta pendientes (talla no nula, no pusheadas)', async () => {
    const db = await getDb();
    (db.getAllAsync as jest.Mock).mockResolvedValueOnce([{ id: 'X', talla: 'M', confidence: 0.9 }]);
    const rows = await readPendingTallaPush(db);
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.stringMatching(/talla IS NOT NULL[\s\S]*talla_pushed = 0/));
    expect(rows).toEqual([{ id: 'X', talla: 'M', confidence: 0.9 }]);
  });

  test('markTallasPushed setea talla_pushed=1 para los ids dados', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await markTallasPushed(db, ['A', 'B']);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('talla_pushed = 1'),
      ['A', 'B'],
    );
  });

  test('markTallasPushed no hace nada con lista vacía', async () => {
    const db = await getDb();
    (db.runAsync as jest.Mock).mockClear();
    await markTallasPushed(db, []);
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});

describe('upsertServerRaw', () => {
  test('upsertea members, issues (con merge de talla) y transitions', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValue(null); // transición no existe -> se inserta
    (db.runAsync as jest.Mock).mockClear();
    await upsertServerRaw(db, {
      issues: [{ id: 'S-1', title: 't', description: '', status: 'Done', assignee_id: 'u1', talla: 'M', talla_confidence: 0.9, created_at: 'c', updated_at: 'u', last_transition_at: 'l' }],
      transitions: [{ issue_id: 'S-1', from_status: 'To Do', to_status: 'Done', transitioned_at: '2026-06-01T00:00:00Z' }],
      members: [{ id: 'u1', display_name: 'Ana', email: 'a@t.com', avatar_url: null }],
      serverSyncedAt: '2026-06-01T00:05:00Z',
    });
    // team_members upsert
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INTO team_members'), expect.arrayContaining(['u1', 'Ana']));
    // issues upsert con COALESCE (no pisa talla local con null) y talla_pushed
    const issueCall = (db.runAsync as jest.Mock).mock.calls.find(c => String(c[0]).includes('INTO issues'));
    expect(issueCall).toBeTruthy();
    expect(String(issueCall![0])).toContain('COALESCE(excluded.talla, issues.talla)');
    expect(String(issueCall![0])).toContain('talla_pushed');
    // transición insertada
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INTO transitions'), ['S-1', 'To Do', 'Done', '2026-06-01T00:00:00Z']);
  });

  test('marca talla_pushed=1 cuando la talla viene del server; 0 cuando viene null', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock).mockResolvedValue(null);
    (db.runAsync as jest.Mock).mockClear();
    await upsertServerRaw(db, {
      issues: [
        { id: 'WITH', title: 't', description: '', status: 'Done', assignee_id: null, talla: 'L', talla_confidence: 0.8, created_at: 'c', updated_at: 'u', last_transition_at: null },
        { id: 'NULL', title: 't', description: '', status: 'Done', assignee_id: null, talla: null, talla_confidence: null, created_at: 'c', updated_at: 'u', last_transition_at: null },
      ],
      transitions: [], members: [], serverSyncedAt: null,
    });
    const calls = (db.runAsync as jest.Mock).mock.calls.filter(c => String(c[0]).includes('INTO issues'));
    // el arg de talla_pushed es el último parámetro del array de valores del INSERT
    const withPushed = calls.find(c => c[1].includes('WITH'))![1];
    const nullPushed = calls.find(c => c[1].includes('NULL'))![1];
    expect(withPushed[withPushed.length - 1]).toBe(1);
    expect(nullPushed[nullPushed.length - 1]).toBe(0);
  });
});

describe('getRawSince', () => {
  test('devuelve el ISO más nuevo entre board_sync[boardId] y board_sync[0]', async () => {
    const db = await getDb();
    // getBoardLastSync(boardId) -> primera llamada; getBoardLastSync(0) -> segunda
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce({ last_synced_at: '2026-06-01T00:00:00Z' })  // board
      .mockResolvedValueOnce({ last_synced_at: '2026-07-01T00:00:00Z' }); // sentinela
    const since = await getRawSince(db, 7);
    expect(since).toBe('2026-07-01T00:00:00Z');
  });

  test('devuelve el definido cuando el otro falta', async () => {
    const db = await getDb();
    (db.getFirstAsync as jest.Mock)
      .mockResolvedValueOnce(null)                                        // board sin marca
      .mockResolvedValueOnce({ last_synced_at: '2026-07-01T00:00:00Z' }); // sentinela
    const since = await getRawSince(db, 7);
    expect(since).toBe('2026-07-01T00:00:00Z');
  });
});
