import { describe, it, expect } from 'vitest';
import { categorize, ACTIVE_STATUSES, DONE_STATUSES } from './statusCategories';

describe('categorize', () => {
  it('maps known statuses to categories', () => {
    expect(categorize('In Progress')).toBe('active');
    expect(categorize('EN CURSO')).toBe('active');
    expect(categorize('Blocked')).toBe('blocked');
    expect(categorize('Ready for Development')).toBe('waiting');
    expect(categorize('Done')).toBe('done');
    expect(categorize('Finalizada')).toBe('done');
    expect(categorize('Backlog')).toBe('todo');
    expect(categorize('Cancelado')).toBe('cancelled');
  });

  it('returns "unknown" for unmapped statuses', () => {
    expect(categorize('Some Custom Status')).toBe('unknown');
  });

  it('exposes active and done status lists', () => {
    expect(ACTIVE_STATUSES).toContain('In Progress');
    expect(DONE_STATUSES).toContain('Done');
  });
});
