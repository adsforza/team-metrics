import { describe, it, expect } from 'vitest';
import { percentile, median } from './stats';

describe('percentile', () => {
  it('returns null for empty input', () => {
    expect(percentile([], 50)).toBeNull();
  });
  it('interpolates between values', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30], 85)).toBeCloseTo(27, 5);
  });
});

describe('median', () => {
  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
  });
  it('sorts before computing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
