import { Router } from 'express';
import { getDb } from '../db/index';
import { getWorkload, getRequesterDetail } from '../services/workload';

const router = Router();

router.get('/', (req, res, next) => {
  try {
    res.json(getWorkload(getDb(), { from: req.query.from as string, to: req.query.to as string }));
  } catch (err) { next(err); }
});

router.get('/detail', (req, res, next) => {
  try {
    const boardId = Number(req.query.board_id);
    if (!boardId) return res.status(400).json({ error: 'board_id requerido' });
    // requester ausente => bucket "sin dato" (null); string vacio se trata igual.
    const requester = req.query.requester === undefined || req.query.requester === ''
      ? null : String(req.query.requester);
    const scope = req.query.scope === 'todos' ? 'todos' as const : 'pendientes' as const;
    res.json(getRequesterDetail(getDb(), {
      board_id: boardId, requester, scope,
      from: req.query.from as string, to: req.query.to as string,
    }));
  } catch (err) { next(err); }
});

export default router;
