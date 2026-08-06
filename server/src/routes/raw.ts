import { Router } from 'express';
import { getDb } from '../db/index';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const since = req.query.since as string | undefined;

    const allIssues = db.prepare(
      `SELECT id, title, description, status, assignee_id, talla, talla_confidence,
              created_at, updated_at, last_transition_at
       FROM issues`,
    ).all() as any[];

    // Filtro por since en JS: los updated_at de Jira traen offset (-0300) que
    // julianday()/comparación lexical de SQLite no maneja; Date.parse sí.
    const sinceMs = since ? Date.parse(since) : null;
    const issues = sinceMs != null && !isNaN(sinceMs)
      ? allIssues.filter(i => Date.parse(i.updated_at) >= sinceMs)
      : allIssues;

    const ids = new Set(issues.map(i => i.id));
    const allTransitions = db.prepare(
      `SELECT issue_id, from_status, to_status, transitioned_at FROM transitions`,
    ).all() as any[];
    const transitions = allTransitions.filter(t => ids.has(t.issue_id));

    const members = db.prepare(
      `SELECT id, display_name, email, avatar_url FROM team_members`,
    ).all() as any[];

    const lastSync = db.prepare(
      `SELECT finished_at FROM sync_log WHERE error IS NULL AND finished_at IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    ).get() as { finished_at: string } | undefined;

    res.json({
      issues,
      transitions,
      members,
      serverSyncedAt: lastSync?.finished_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
