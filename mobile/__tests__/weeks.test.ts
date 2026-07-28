// Reproduce the Argentina (UTC-3) evening case where the old local/UTC mix drifted a day.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { getLastNMondays } from '../lib/weeks';

const isUtcMonday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() === 1;

describe('getLastNMondays', () => {
  it('maps a Monday-evening ART time to that same Monday (no +1 day drift)', () => {
    // Mon 2026-07-13 23:30 ART == Tue 02:30 UTC. Must still be the week of Mon 2026-07-13.
    const res = getLastNMondays(6, new Date('2026-07-13T23:30:00-03:00'));
    expect(res[0]).toBe('2026-07-13');
    expect(res.every(isUtcMonday)).toBe(true);
  });

  it('returns weeks 7 days apart, newest first', () => {
    const res = getLastNMondays(3, new Date('2026-07-15T12:00:00-03:00'));
    expect(res).toEqual(['2026-07-13', '2026-07-06', '2026-06-29']);
  });
});
