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
import { getDb, hasData, readPendingTallaPush, markTallasPushed, updateIssueTallas } from '../lib/db';

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
