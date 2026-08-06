import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { getKPIs, getCycleTimeByTalla, getThroughputWeekly, getAgingWIP } from './metrics';

function seedDb(db: Database.Database) {
  db.prepare(`INSERT INTO team_members VALUES ('u1','Ana G','ana@t.com',null)`).run();
  db.prepare(`INSERT INTO team_members VALUES ('u2','Bob R','bob@t.com',null)`).run();

  // Issue 1: Done, talla M, assignee u1 — cycle time 3 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-1','Fix login','desc','Done','u1','M',0.9,'2026-05-01T00:00:00Z','2026-05-04T00:00:00Z','2026-06-01T00:00:00Z','2026-05-04T00:00:00Z',NULL)`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-1','To Do','In Progress','2026-05-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-1','In Progress','Done','2026-05-04T00:00:00Z')`).run();

  // Issue 2: Done, talla L, assignee u2 — cycle time 7 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-2','Deploy infra','desc','Done','u2','L',0.85,'2026-05-01T00:00:00Z','2026-05-08T00:00:00Z','2026-06-01T00:00:00Z','2026-05-08T00:00:00Z',NULL)`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-2','To Do','In Progress','2026-05-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-2','In Progress','Done','2026-05-08T00:00:00Z')`).run();

  // Issue 3: In Progress (WIP), talla S, assignee u1, stuck 10 days
  db.prepare(`INSERT INTO issues VALUES ('OPS-3','Update config','desc','In Progress','u1','S',0.95,'2026-05-20T00:00:00Z','2026-05-20T00:00:00Z','2026-06-01T00:00:00Z','2026-05-20T00:00:00Z',NULL)`).run();
  db.prepare(`INSERT INTO transitions (issue_id,from_status,to_status,transitioned_at) VALUES ('OPS-3','To Do','In Progress','2026-05-20T00:00:00Z')`).run();
}

describe('metrics service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    seedDb(db);
  });

  describe('getKPIs', () => {
    it('returns correct wip count', () => {
      const kpi = getKPIs(db, {});
      expect(kpi.wip).toBe(1); // OPS-3 is In Progress
    });

    it('returns correct throughput for date range', () => {
      const kpi = getKPIs(db, { from: '2026-05-01', to: '2026-05-31' });
      expect(kpi.throughput).toBe(2);
    });

    it('returns cycle time percentiles', () => {
      const kpi = getKPIs(db, { from: '2026-05-01', to: '2026-05-31' });
      expect(kpi.cycle_time_p50).toBeCloseTo(5, 0); // median of [3,7]
      expect(kpi.cycle_time_p85).toBeCloseTo(6.4, 0); // 85th percentile with interpolation
    });
  });

  describe('getCycleTimeByTalla', () => {
    it('returns ct_p50 per talla', () => {
      const result = getCycleTimeByTalla(db, { from: '2026-05-01', to: '2026-05-31' });
      const m = result.find(r => r.talla === 'M');
      const l = result.find(r => r.talla === 'L');
      expect(m?.ct_p50).toBeCloseTo(3, 0);
      expect(l?.ct_p50).toBeCloseTo(7, 0);
    });
  });

  describe('getAgingWIP', () => {
    it('returns in-progress issues sorted by days', () => {
      const aging = getAgingWIP(db, {});
      expect(aging).toHaveLength(1);
      expect(aging[0].issue_id).toBe('OPS-3');
      expect(aging[0].days_in_status).toBeGreaterThan(0);
    });
  });
});
