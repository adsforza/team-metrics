import Database from 'better-sqlite3';
import path from 'path';
import { applySchema } from './schema';

const DB_PATH = path.resolve(process.cwd(), '../data/kanban.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.');
  return _db;
}

export function initDb(dbPath = DB_PATH): Database.Database {
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applySchema(_db);
  return _db;
}
