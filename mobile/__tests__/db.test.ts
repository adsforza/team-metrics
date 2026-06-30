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
import { getDb, hasData } from '../lib/db';

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
