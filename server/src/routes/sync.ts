import { Router } from 'express';
import { getDb } from '../db/index';
import { runSync } from '../services/sync';
import { classifyTallaBatch } from '../services/claude';

const router = Router();

router.post('/', async (_req, res) => {
  try {
    const result = await runSync(getDb());
    res.json({ status: 'ok', ...result });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/reclassify', async (_req, res) => {
  const db = getDb();
  const issues = db.prepare(
    `SELECT id, title, description FROM issues WHERE talla IS NULL ORDER BY created_at DESC`
  ).all() as any[];
  res.json({ status: 'started', pending: issues.length });

  const BATCH_SIZE = 20;
  const DELAY_MS = 8000; // ~7 requests/min dentro del límite de 2500 TPM

  (async () => {
    let classified = 0;
    for (let i = 0; i < issues.length; i += BATCH_SIZE) {
      const batch = issues.slice(i, i + BATCH_SIZE);
      try {
        const results = await classifyTallaBatch(batch);
        for (const issue of batch) {
          const r = results.get(issue.id);
          if (r) {
            db.prepare(`UPDATE issues SET talla = ?, talla_confidence = ?, talla_updated_at = ? WHERE id = ?`)
              .run(r.talla, r.confidence, new Date().toISOString(), issue.id);
            if (r.talla) classified++;
          }
        }
        console.log(`Reclassify: ${classified} clasificados, ${issues.length - i - batch.length} pendientes`);
      } catch (err: any) {
        console.error(`Reclassify batch error (i=${i}):`, err.message);
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
    console.log(`Reclassify done: ${classified}/${issues.length}`);
  })();
});

router.get('/status', (_req, res) => {
  const log = getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').get();
  const pending = (getDb().prepare(`SELECT COUNT(*) as c FROM issues WHERE talla IS NULL`).get() as any).c;
  res.json({ ...(log ?? { status: 'never_synced' }), unclassified: pending });
});

export default router;
