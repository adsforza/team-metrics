import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../db/schema';
import { dailyThroughput } from './forecast';

function seedDone(db: Database.Database, id: string, doneAt: string) {
  db.prepare(`INSERT INTO issues VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `I ${id}`, '', 'Done', null, 'M', 0.9, '2026-01-01T00:00:00Z', doneAt, '2026-06-25T00:00:00Z', doneAt,
  );
  db.prepare(`INSERT INTO transitions (issue_id, from_status, to_status, transitioned_at) VALUES (?,?,?,?)`)
    .run(id, 'In Progress', 'Done', doneAt);
}

describe('dailyThroughput', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applySchema(db); });

  it('buckets completions into the correct day within the lookback window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    seedDone(db, 'A-1', '2026-06-24T10:00:00Z');
    seedDone(db, 'A-2', '2026-06-24T20:00:00-0300');
    seedDone(db, 'A-3', '2026-06-25T09:00:00Z');
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily).toHaveLength(84);
    expect(daily[83]).toBe(1); // today (2026-06-25)
    expect(daily[82]).toBe(2); // yesterday (2026-06-24)
    expect(daily.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('ignores completions outside the window', () => {
    const asOf = new Date('2026-06-25T12:00:00Z');
    seedDone(db, 'OLD', '2026-01-01T10:00:00Z');
    const daily = dailyThroughput(db, 84, asOf);
    expect(daily.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

import { simulateWhen, simulateHowMany, histogram } from './forecast';

describe('simulateHowMany', () => {
  it('with a constant 1/day history, completes exactly `horizon` items', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateHowMany(daily, 10, 2000, Math.random);
    expect(samples).toHaveLength(2000);
    expect(samples.every(s => s === 10)).toBe(true);
  });
});

describe('simulateWhen', () => {
  it('with a constant 1/day history, needs exactly `items` days', () => {
    const daily = new Array(84).fill(1);
    const samples = simulateWhen(daily, 7, 2000, Math.random);
    expect(samples.every(s => s === 7)).toBe(true);
  });

  it('returns a sorted ascending array', () => {
    const daily = [0, 1, 2, 0, 3, 1];
    const samples = simulateWhen(daily, 5, 1000, Math.random);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });
});

describe('histogram', () => {
  it('returns a single bin when the range is degenerate', () => {
    const bins = histogram(new Array(100).fill(5));
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ x: 5, count: 100 });
  });

  it('partitions samples into ~20 bins covering the central 90%', () => {
    const sorted = Array.from({ length: 1000 }, (_, i) => i).sort((a, b) => a - b);
    const bins = histogram(sorted);
    expect(bins.length).toBe(20);
    const total = bins.reduce((a, b) => a + b.count, 0);
    expect(total).toBeGreaterThan(850);
    expect(total).toBeLessThanOrEqual(1000);
  });
});
