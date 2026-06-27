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
