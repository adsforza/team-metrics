// server/src/services/comparison.ts
// Thin loader: reads issues/transitions from SQLite and delegates the pure computation
// to shared/core/comparison.ts (computeComparison). See that file for the actual logic.
import Database from 'better-sqlite3';
import { computeComparison } from '../../../shared/core/comparison';
import type { CoreIssue, CoreTransition } from '../../../shared/core/types';
import type { ComparisonResult } from '../types';

export function getComparison(
  db: Database.Database,
  opts: { week?: string; now?: Date; assignee?: string | null } = {}
): ComparisonResult {
  const issues = db.prepare(`
    SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues
  `).all() as CoreIssue[];
  const transitions = db.prepare(`
    SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
  `).all() as CoreTransition[];

  return computeComparison(issues, transitions, opts);
}
