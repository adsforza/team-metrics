import { Router } from 'express';
import { getDb } from '../db/index';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const params: FilterParams = {
      from: req.query.from as string,
      to: req.query.to as string,
      assignee: req.query.assignee as string,
      talla: req.query.talla as string,
      status: req.query.status as string,
    };

    const conditions: string[] = [];
    const args: any[] = [];

    if (params.assignee) { conditions.push('assignee_id = ?'); args.push(params.assignee); }
    if (params.talla) {
      const ts = params.talla.split(',');
      conditions.push(`talla IN (${ts.map(() => '?').join(',')})`);
      args.push(...ts);
    }
    if (params.status) {
      const ss = params.status.split(',');
      conditions.push(`status IN (${ss.map(() => '?').join(',')})`);
      args.push(...ss);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT
        i.*,
        t_start.start_at AS _start_at,
        t_end.end_at     AS _end_at
      FROM issues i
      LEFT JOIN (
        SELECT issue_id, MIN(transitioned_at) AS start_at FROM transitions
        WHERE to_status IN ('In Progress','IN PROGRESS','EN CURSO','In development')
        GROUP BY issue_id
      ) t_start ON t_start.issue_id = i.id
      LEFT JOIN (
        SELECT issue_id, MAX(transitioned_at) AS end_at FROM transitions
        WHERE to_status IN ('Done','Finalizada')
        GROUP BY issue_id
      ) t_end ON t_end.issue_id = i.id
      ${where}
      ORDER BY i.last_transition_at DESC
    `).all(...args) as any[];

    // ct_days se calcula en JS (no con julianday()): los timestamps de Jira vienen como
    // "...-0300" (offset sin colon), que Date.parse interpreta bien pero julianday() de
    // SQLite no — devuelve NULL silenciosamente con ese formato.
    const issues = rows.map(({ _start_at, _end_at, ...issue }) => {
      const ct_days = issue.status && ['Done', 'Finalizada'].includes(issue.status) && _start_at && _end_at
        ? (new Date(_end_at).getTime() - new Date(_start_at).getTime()) / (1000 * 60 * 60 * 24)
        : null;
      return { ...issue, ct_days };
    });

    res.json(issues);
  } catch (err) {
    next(err);
  }
});

export default router;
