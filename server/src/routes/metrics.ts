import { Router } from 'express';
import { getDb } from '../db/index';
import { getKPIs, getCycleTimeByTalla, getCFD, getThroughputWeekly, getAgingWIP } from '../services/metrics';
import { getForecast } from '../services/forecast';
import { getWipRisk } from '../services/wipRisk';
import { getBottleneck } from '../services/bottleneck';
import type { FilterParams } from '../types';

const router = Router();

function parseFilters(q: any): FilterParams {
  return { from: q.from, to: q.to, assignee: q.assignee, talla: q.talla, status: q.status };
}

router.get('/', (req, res, next) => {
  try {
    res.json(getKPIs(getDb(), parseFilters(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get('/by-talla', (req, res, next) => {
  try {
    res.json(getCycleTimeByTalla(getDb(), parseFilters(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get('/cfd', (req, res, next) => {
  try {
    res.json(getCFD(getDb(), parseFilters(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get('/throughput', (req, res, next) => {
  try {
    res.json(getThroughputWeekly(getDb(), parseFilters(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get('/aging', (req, res, next) => {
  try {
    res.json(getAgingWIP(getDb(), parseFilters(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get('/forecast', (req, res, next) => {
  try {
    res.json(getForecast(getDb(), { items: req.query.items, horizon: req.query.horizon }));
  } catch (err) {
    next(err);
  }
});

router.get('/wip-risk', (_req, res, next) => {
  try {
    res.json(getWipRisk(getDb()));
  } catch (err) {
    next(err);
  }
});

router.get('/bottleneck', (_req, res, next) => {
  try { res.json(getBottleneck(getDb())); } catch (err) { next(err); }
});

export default router;
