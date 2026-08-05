import { Router } from 'express';
import { getDb } from '../db/index';

const router = Router();
const VALID_TALLAS = new Set(['S', 'M', 'L', 'XL']);

router.post('/', (req, res, next) => {
  try {
    const body = req.body;
    if (!Array.isArray(body)) {
      res.status(400).json({ error: 'body must be an array of { id, talla, confidence }' });
      return;
    }
    const db = getDb();
    const stmt = db.prepare(
      `UPDATE issues SET talla = ?, talla_confidence = ? WHERE id = ? AND talla IS NULL`,
    );
    const apply = db.transaction((items: any[]) => {
      let updated = 0;
      for (const it of items) {
        if (!it || typeof it.id !== 'string' || !VALID_TALLAS.has(it.talla)) continue;
        const conf = typeof it.confidence === 'number' ? it.confidence : null;
        const info = stmt.run(it.talla, conf, it.id);
        updated += info.changes;
      }
      return updated;
    });
    const updated = apply(body);
    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

export default router;
