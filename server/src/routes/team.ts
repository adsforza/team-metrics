import { Router } from 'express';
import { getDb } from '../db/index';
import { getTeamMetrics } from '../services/metrics';
import type { FilterParams } from '../types';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    const params: FilterParams = { from: req.query.from as string, to: req.query.to as string, talla: req.query.talla as string };
    res.json(getTeamMetrics(getDb(), params));
  } catch (err) {
    next(err);
  }
});

router.get('/members', (_req, res, next) => {
  try {
    res.json(getDb().prepare('SELECT * FROM team_members ORDER BY display_name').all());
  } catch (err) {
    next(err);
  }
});

export default router;
