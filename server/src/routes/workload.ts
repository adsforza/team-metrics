import { Router } from 'express';
import { getDb } from '../db/index';
import { getWorkload } from '../services/workload';

const router = Router();

// Solo el snapshot agregado. El drill-down por solicitante NO tiene endpoint a
// proposito: el mobile lo calcula sobre su copia local del crudo (`issues`) para que
// funcione offline, asi que un /detail en el server no tendria consumidor y su
// contrato divergiria en silencio (p.ej. el centinela del bucket "sin dato").
router.get('/', (req, res, next) => {
  try {
    res.json(getWorkload(getDb(), { from: req.query.from as string, to: req.query.to as string }));
  } catch (err) { next(err); }
});

export default router;
