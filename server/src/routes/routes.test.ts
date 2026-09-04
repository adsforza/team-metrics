import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';

// Mock DB singleton before importing app
const mockDb = new Database(':memory:');
applySchema(mockDb);
mockDb.prepare(`INSERT INTO team_members VALUES ('u1','Ana G','ana@t.com',null)`).run();
mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('OPS-1','Fix login','desc','In Progress','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-01T00:00:00Z',NULL)`).run();

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
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('TAL-1','a','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z',NULL)`).run();
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('TAL-2','b','','Done','u1','L',0.7,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z')`).run();
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
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('TAL-3','c','','Done','u1',NULL,NULL,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z','2026-05-02T00:00:00Z',NULL)`).run();
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

describe('GET /api/raw', () => {
  beforeAll(() => {
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('RAW-OLD','old','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z','2026-01-10T00:00:00Z','2026-01-10T00:00:00Z',NULL)`).run();
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at) VALUES ('RAW-NEW','new','','In Progress','u1',NULL,NULL,'2026-06-01T00:00:00Z','2026-06-20T00:00:00Z','2026-06-20T00:00:00Z','2026-06-20T00:00:00Z',NULL)`).run();
    mockDb.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('RAW-NEW','To Do','In Progress','2026-06-05T00:00:00Z')`).run();
    mockDb.prepare(`INSERT INTO sync_log (started_at,finished_at,synced_count,classified_count,error) VALUES ('2026-06-21T00:00:00Z','2026-06-21T00:05:00Z',10,5,NULL)`).run();
  });

  it('sin since devuelve issues, transitions, members y serverSyncedAt', async () => {
    const res = await request(app).get('/api/raw');
    expect(res.status).toBe(200);
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('RAW-OLD');
    expect(ids).toContain('RAW-NEW');
    expect(Array.isArray(res.body.transitions)).toBe(true);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.serverSyncedAt).toBe('2026-06-21T00:05:00Z');
  });

  it('con since filtra por updated_at (en JS, tolera offset)', async () => {
    const res = await request(app).get('/api/raw?since=2026-03-01T00:00:00Z');
    expect(res.status).toBe(200);
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('RAW-NEW');
    expect(ids).not.toContain('RAW-OLD');
    // transitions solo de los issues devueltos
    for (const t of res.body.transitions) {
      expect(ids).toContain(t.issue_id);
    }
  });
});

describe('GET /api/workload', () => {
  beforeAll(() => {
    mockDb.prepare(`INSERT INTO board_sync (board_id, last_synced_at, name) VALUES (9534, '2026-06-01T00:00:00Z', 'Squad Groot')`).run();
    // Pedido real: creado dentro del rango, en el board 9534 y todavia pendiente.
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at, requester, boards, priority)
      VALUES ('WL-1','Pedido de Groot','','In Progress','u1',NULL,NULL,'2026-06-10T00:00:00Z','2026-06-10T00:00:00Z','2026-06-10T00:00:00Z','2026-06-10T00:00:00Z',NULL,'Groot','9534','High (P1)')`).run();
    // Mismo solicitante y board, pero cerrado y creado fuera del rango: ni pedido ni
    // pendiente. Esta para que los contadores de abajo no puedan salir bien de casualidad.
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at, requester, boards, priority)
      VALUES ('WL-VIEJO','Cerrado y viejo','','Done','u1',NULL,NULL,'2026-01-05T00:00:00Z','2026-01-06T00:00:00Z','2026-01-06T00:00:00Z','2026-01-06T00:00:00Z',NULL,'Groot','9534',NULL)`).run();
    // boards NULL: no pertenece a ningun squad conocido.
    mockDb.prepare(`INSERT INTO issues (id, title, description, status, assignee_id, talla, talla_confidence, created_at, updated_at, synced_at, last_transition_at, talla_updated_at, requester, boards, priority)
      VALUES ('WL-NULLBOARDS','sin boards','','In Progress','u1',NULL,NULL,'2026-06-10T00:00:00Z','2026-06-10T00:00:00Z','2026-06-10T00:00:00Z','2026-06-10T00:00:00Z',NULL,'Groot',NULL,NULL)`).run();
  });

  it('devuelve el squad con su nombre y los pedidos/pendientes de cada solicitante', async () => {
    const res = await request(app).get('/api/workload?from=2026-06-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const groot = res.body.squads.find((s: any) => s.board_id === 9534);
    expect(groot).toBeDefined();
    expect(groot.name).toBe('Squad Groot');            // el nombre sale de board_sync
    const fila = groot.requesters.find((r: any) => r.requester === 'Groot');
    expect(fila).toEqual({ requester: 'Groot', pedidos: 1, pendientes: 1 });
    expect(groot.pedidos).toBe(1);
    expect(groot.pendientes).toBe(1);                  // WL-VIEJO (cerrado, fuera de rango) no suma
    expect(res.body.totals).toHaveProperty('compartidos');
  });

  it('un issue con boards NULL en la base no rompe el endpoint ni entra en ningun squad', async () => {
    const res = await request(app).get('/api/workload?from=2026-06-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const groot = res.body.squads.find((s: any) => s.board_id === 9534);
    // WL-NULLBOARDS tiene el mismo requester que WL-1; si el parseo de boards lo dejara
    // colarse, la fila de Groot marcaria 2 pedidos en vez de 1.
    expect(groot.requesters.find((r: any) => r.requester === 'Groot').pedidos).toBe(1);
  });
});

describe('GET /api/raw — columnas y boards de carga de trabajo', () => {
  it('el crudo trae requester, boards y priority del issue', async () => {
    const res = await request(app).get('/api/raw');
    const wl1 = res.body.issues.find((i: any) => i.id === 'WL-1');
    expect(wl1).toBeDefined();
    // Sin estas tres el drill-down del mobile en backend mode queda permanentemente vacio.
    expect(wl1.requester).toBe('Groot');
    expect(wl1.boards).toBe('9534');
    expect(wl1.priority).toBe('High (P1)');
  });

  it('el crudo trae los boards con su nombre', async () => {
    const res = await request(app).get('/api/raw');
    expect(res.body.boards).toContainEqual({ board_id: 9534, name: 'Squad Groot' });
  });

  it('los boards viajan completos aunque el delta filtre por since', async () => {
    const res = await request(app).get('/api/raw?since=2030-01-01T00:00:00Z');
    expect(res.body.issues).toHaveLength(0);
    expect(res.body.boards).toContainEqual({ board_id: 9534, name: 'Squad Groot' });
  });
});

describe('talla_updated_at (propagación de tallas por delta)', () => {
  it('POST /api/tallas setea talla_updated_at al llenar una talla', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at)
      VALUES ('TUA-1','x','','Done','u1',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`).run();
    const res = await request(app).post('/api/tallas').send([{ id: 'TUA-1', talla: 'M', confidence: 0.9 }]);
    expect(res.body).toEqual({ updated: 1 });
    const row = mockDb.prepare(`SELECT talla_updated_at FROM issues WHERE id='TUA-1'`).get() as any;
    expect(typeof row.talla_updated_at).toBe('string');
    expect(row.talla_updated_at.length).toBeGreaterThan(0);
  });

  it('GET /api/raw?since incluye un issue con talla_updated_at reciente aunque updated_at sea viejo, y no expone la columna', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at,talla_updated_at)
      VALUES ('TUA-2','y','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-07-01T00:00:00Z')`).run();
    const res = await request(app).get('/api/raw?since=2026-06-01T00:00:00Z');
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).toContain('TUA-2');
    const tua2 = res.body.issues.find((i: any) => i.id === 'TUA-2');
    expect(tua2).not.toHaveProperty('talla_updated_at');
  });

  it('GET /api/raw?since excluye issue viejo sin talla_updated_at', async () => {
    mockDb.prepare(`INSERT INTO issues (id,title,description,status,assignee_id,talla,talla_confidence,created_at,updated_at,synced_at,last_transition_at)
      VALUES ('TUA-3','z','','Done','u1','S',0.9,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`).run();
    const res = await request(app).get('/api/raw?since=2026-06-01T00:00:00Z');
    const ids = res.body.issues.map((i: any) => i.id);
    expect(ids).not.toContain('TUA-3');
  });
});
