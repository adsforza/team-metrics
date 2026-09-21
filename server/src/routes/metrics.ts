import { Router } from 'express';
import { getDb } from '../db/index';
import { getKPIs, getCycleTimeByTalla, getCFD, getThroughputWeekly, getAgingWIP } from '../services/metrics';
import { getForecast } from '../services/forecast';
import { getWipRisk } from '../services/wipRisk';
import { getBottleneck } from '../services/bottleneck';
import { getComparison } from '../services/comparison';
import type { FilterParams } from '../types';

const router = Router();

function parseFilters(q: any): FilterParams {
  // La API publica sigue aceptando ?assignee=<id> (el cliente web la usa asi).
  // El core ahora piensa en listas: se traduce aca, en un solo lugar.
  // typeof === 'string' y no solo truthy: Express entrega un array si el
  // parametro viene repetido (?assignee=a&assignee=b), y String(array) da
  // 'a,b' -> un id inexistente que vacia el resultado en vez de ignorarse.
  // Las otras rutas de este archivo ya usan esta misma guarda.
  const assignee = typeof q.assignee === 'string' && q.assignee ? q.assignee : undefined;
  return {
    from: q.from, to: q.to, talla: q.talla, status: q.status,
    assignees: assignee ? [assignee] : undefined,
  };
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
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    res.json(getForecast(getDb(), { items: req.query.items, horizon: req.query.horizon, assignee }));
  } catch (err) {
    next(err);
  }
});

router.get('/wip-risk', (req, res, next) => {
  try {
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    res.json(getWipRisk(getDb(), { assignee }));
  } catch (err) {
    next(err);
  }
});

router.get('/bottleneck', (req, res, next) => {
  try {
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    res.json(getBottleneck(getDb(), { assignee }));
  } catch (err) {
    next(err);
  }
});

router.get('/comparison', (req, res, next) => {
  try {
    const week = typeof req.query.week === 'string' ? req.query.week : undefined;
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    res.json(getComparison(getDb(), { week, assignee }));
  } catch (err) { next(err); }
});

export default router;
