import { Router } from 'express';
import { getDb } from '../db/index';
import { getKPIs, getCycleTimeByTalla, getCFD, getThroughputWeekly, getAgingWIP } from '../services/metrics';
import type { FilterParams } from '../types';

const router = Router();

function parseFilters(q: any): FilterParams {
  return { from: q.from, to: q.to, assignee: q.assignee, talla: q.talla, status: q.status };
}

router.get('/', (req, res) => res.json(getKPIs(getDb(), parseFilters(req.query))));
router.get('/by-talla', (req, res) => res.json(getCycleTimeByTalla(getDb(), parseFilters(req.query))));
router.get('/cfd', (req, res) => res.json(getCFD(getDb(), parseFilters(req.query))));
router.get('/throughput', (req, res) => res.json(getThroughputWeekly(getDb(), parseFilters(req.query))));
router.get('/aging', (req, res) => res.json(getAgingWIP(getDb(), parseFilters(req.query))));

export default router;
