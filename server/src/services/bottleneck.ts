// server/src/services/bottleneck.ts
// Thin loader: reads issues/transitions from SQLite and delegates the pure computation
// to shared/core/bottleneck.ts (computeBottleneck). See that file for the actual logic.
import Database from 'better-sqlite3';
import { computeBottleneck } from '../../../shared/core/bottleneck';
import type { CoreIssueWithTitle, CoreTransition } from '../../../shared/core/types';
import type { BottleneckResult } from '../types';

export function getBottleneck(
  db: Database.Database,
  opts: { now?: Date; assignee?: string | null } = {},
): BottleneckResult {
  const issues = db.prepare(`
    SELECT id, title, status, assignee_id, talla, created_at, last_transition_at FROM issues
  `).all() as CoreIssueWithTitle[];
  const transitions = db.prepare(`
    SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
  `).all() as CoreTransition[];

  return computeBottleneck(issues, transitions, opts);
}
