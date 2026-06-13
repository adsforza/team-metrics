import { Router } from 'express';
import { getDb } from '../db/index';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res) => {
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
  const issues = db.prepare(`SELECT * FROM issues ${where} ORDER BY last_transition_at DESC`).all(...args);
  res.json(issues);
});

export default router;
