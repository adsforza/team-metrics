// server/src/services/wipRisk.ts
// Thin loader: reads issues/transitions from SQLite and delegates the pure computation
// to shared/core/wipRisk.ts (computeWipRisk). See that file for the actual logic.
import Database from 'better-sqlite3';
import { computeWipRisk } from '../../../shared/core/wipRisk';
import type { CoreIssueWithTitle, CoreTransition } from '../../../shared/core/types';
import type { WipRiskResult } from '../types';

export function getWipRisk(db: Database.Database, opts: { now?: Date } = {}): WipRiskResult {
  const issues = db.prepare(`
    SELECT id, title, status, assignee_id, talla, created_at, last_transition_at FROM issues
  `).all() as CoreIssueWithTitle[];
  const transitions = db.prepare(`
    SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
  `).all() as CoreTransition[];

  return computeWipRisk(issues, transitions, opts);
}
