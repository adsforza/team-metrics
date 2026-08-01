// server/src/services/scorecard.ts
// Thin loader: reads issues/transitions/members from SQLite and delegates the pure computation
// to shared/core/scorecard.ts (computeScorecard). See that file for the actual logic.
import Database from 'better-sqlite3';
import { computeScorecard, makeDimension, resolveWindows } from '../../../shared/core/scorecard';
import type { CoreIssue, CoreTransition, CoreMember } from '../../../shared/core/types';
import type { FilterParams, TeamScorecardResponse } from '../types';

export { makeDimension, resolveWindows }; // keep existing test imports working

export function getTeamScorecard(db: Database.Database, params: FilterParams): TeamScorecardResponse {
  const issues = db.prepare(`
    SELECT id, status, assignee_id, talla, created_at, last_transition_at FROM issues
  `).all() as CoreIssue[];
  const transitions = db.prepare(`
    SELECT issue_id, from_status, to_status, transitioned_at FROM transitions
  `).all() as CoreTransition[];
  const members = db.prepare(`
    SELECT id, display_name, email, avatar_url FROM team_members ORDER BY display_name
  `).all() as CoreMember[];

  return computeScorecard(issues, transitions, members, params);
}
