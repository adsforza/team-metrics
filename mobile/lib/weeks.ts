// Returns the last n ISO week-start Mondays (UTC), newest first, as 'YYYY-MM-DD'.
// All date math is done in UTC so the result never drifts by the local timezone
// offset (e.g. an evening sync in UTC-3 must not roll a Monday into Tuesday).
export function getLastNMondays(n: number, now: Date = new Date()): string[] {
  const mondays: string[] = [];
  const dow = now.getUTCDay();            // 0=Sun .. 6=Sat
  const daysSinceMonday = (dow + 6) % 7;  // Mon=0
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  thisMonday.setUTCDate(thisMonday.getUTCDate() - daysSinceMonday);
  for (let i = 0; i < n; i++) {
    const mon = new Date(thisMonday);
    mon.setUTCDate(thisMonday.getUTCDate() - i * 7);
    mondays.push(mon.toISOString().slice(0, 10));
  }
  return mondays;
}
