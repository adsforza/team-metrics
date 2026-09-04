import Database from 'better-sqlite3';
import { computeWorkload, parseBoardsColumn } from '../../../shared/core/workload';
import type { WorkloadResult } from '../../../shared/core/workload';
import type { CoreIssueWorkload } from '../../../shared/core/types';

function loadIssues(db: Database.Database): CoreIssueWorkload[] {
  const rows = db.prepare(
    `SELECT id, title, status, assignee_id, talla, created_at, last_transition_at,
            requester, priority, boards FROM issues`
  ).all() as any[];
  return rows.map(r => ({ ...r, boards: parseBoardsColumn(r.boards) }));
}

function loadBoards(db: Database.Database): { id: number; name: string }[] {
  return (db.prepare(`SELECT board_id AS id, name FROM board_sync ORDER BY board_id`).all() as any[])
    .map(b => ({ id: b.id, name: b.name ?? `Board ${b.id}` }));
}

export function getWorkload(db: Database.Database, params: { from?: string; to?: string }): WorkloadResult {
  return computeWorkload(loadIssues(db), loadBoards(db), params);
}
