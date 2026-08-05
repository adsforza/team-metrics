import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';

// Mock DB singleton before importing app
const mockDb = new Database(':memory:');
applySchema(mockDb);
mockDb.prepare(`INSERT INTO team_members VALUES ('u1','Ana G','ana@t.com',null)`).run();
mockDb.prepare(`INSERT INTO issues VALUES ('OPS-1','Fix login','desc','In Progress','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-01T00:00:00Z')`).run();

vi.mock('../db/index', () => ({ getDb: () => mockDb, initDb: () => mockDb }));
vi.mock('../services/sync', () => ({ startSyncJob: vi.fn(), runSync: vi.fn().mockResolvedValue({ synced_count: 0, classified_count: 0 }) }));

import { app } from '../index';

describe('GET /api/issues', () => {
  it('returns 200 with array', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/metrics', () => {
  it('returns 200 with kpi shape', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('wip');
    expect(res.body).toHaveProperty('throughput');
    expect(res.body).toHaveProperty('cycle_time_p50');
  });
});

describe('GET /api/team', () => {
  it('returns 200 with scorecard shape', async () => {
    const res = await request(app).get('/api/team');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('team');
    expect(res.body).toHaveProperty('members');
    expect(res.body).toHaveProperty('context');
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.team).toHaveProperty('delivery');
  });
});

describe('POST /api/sync', () => {
  it('returns 200 with sync result', async () => {
    const res = await request(app).post('/api/sync');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('synced_count');
  });
});

describe('GET /api/sync/status', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/api/sync/status');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/metrics/forecast', () => {
  it('returns 200 with the forecast shape', async () => {
    const res = await request(app).get('/api/metrics/forecast');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('horizonDays');
    expect(res.body).toHaveProperty('insufficientData');
    expect(res.body).toHaveProperty('lookbackDays', 84);
  });
});

describe('GET /api/metrics/wip-risk', () => {
  it('returns 200 with the wip-risk shape', async () => {
    const res = await request(app).get('/api/metrics/wip-risk');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lookbackDays', 84);
    expect(res.body).toHaveProperty('limits');
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('counts');
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('GET /api/metrics/bottleneck', () => {
  it('returns 200 with BottleneckResult shape', async () => {
    const res = await request(app).get('/api/metrics/bottleneck');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lookbackWeeks', 8);
    expect(typeof res.body.total_active).toBe('number');
    expect(Array.isArray(res.body.states)).toBe(true);
    // The mock DB has 1 issue in 'In Progress' (seeded at top of routes.test.ts)
    if (res.body.states.length > 0) {
      const s = res.body.states[0];
      expect(s).toHaveProperty('status');
      expect(s).toHaveProperty('queue_size');
      expect(s).toHaveProperty('score');
      expect(s).toHaveProperty('detail');
      expect(Array.isArray(s.detail.top_issues)).toBe(true);
    }
  });
});

describe('GET /api/metrics/comparison', () => {
  it('returns 200 with ComparisonResult shape', async () => {
    const res = await request(app).get('/api/metrics/comparison');
    expect(res.status).toBe(200);
    expect(typeof res.body.week).toBe('string');
    expect(typeof res.body.prevWeek).toBe('string');
    expect(typeof res.body.throughput.current).toBe('number');
    expect(typeof res.body.throughput.delta).toBe('number');
    expect(typeof res.body.wip.current).toBe('number');
    expect(typeof res.body.wip.delta).toBe('number');
  });
});

describe('POST /api/tallas', () => {
  beforeAll(() => {
    // TAL-1 sin talla (debe llenarse); TAL-2 ya clasificado (no debe pisarse)
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-1','a','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-2','b','','Done','u1','L',0.7,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
  });

  it('llena solo los huecos y no pisa tallas existentes', async () => {
    const res = await request(app).post('/api/tallas').send([
      { id: 'TAL-1', talla: 'S', confidence: 0.9 },
      { id: 'TAL-2', talla: 'M', confidence: 0.9 },
      { id: 'NOPE', talla: 'M', confidence: 0.9 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    const t1 = mockDb.prepare(`SELECT talla FROM issues WHERE id='TAL-1'`).get() as any;
    const t2 = mockDb.prepare(`SELECT talla FROM issues WHERE id='TAL-2'`).get() as any;
    expect(t1.talla).toBe('S');
    expect(t2.talla).toBe('L'); // intacto
  });

  it('ignora items con talla inválida', async () => {
    mockDb.prepare(`INSERT INTO issues VALUES ('TAL-3','c','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
    const res = await request(app).post('/api/tallas').send([{ id: 'TAL-3', talla: 'XXL', confidence: 0.9 }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it('body vacío devuelve updated 0', async () => {
    const res = await request(app).post('/api/tallas').send([]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it('body no-array devuelve 400', async () => {
    const res = await request(app).post('/api/tallas').send({ nope: true });
    expect(res.status).toBe(400);
  });
});
