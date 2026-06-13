import { Router } from 'express';
import { getDb } from '../db/index';
import { runSync } from '../services/sync';

const router = Router();

router.post('/', async (_req, res) => {
  try {
    const result = await runSync(getDb());
    res.json({ status: 'ok', ...result });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/status', (_req, res) => {
  const log = getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get();
  res.json(log ?? { status: 'never_synced' });
});

export default router;
