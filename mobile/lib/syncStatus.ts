export type SyncStatus = 'ok' | 'partial' | 'offline' | null;

export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'recién';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export function syncStatusText(
  status: SyncStatus,
  lastSyncedAt: string | null,
  mode?: 'backend' | 'direct' | null,
  now: number = Date.now(),
  rawSyncedAt?: string | null,
): string {
  if (status === 'offline') {
    return lastSyncedAt
      ? `⚠ Sin conexión · datos de ${timeAgo(lastSyncedAt, now)}`
      : '⚠ Sin conexión · sin datos aún';
  }
  if (!lastSyncedAt) return '';

  // Los números en pantalla salen del crudo (Task 6), asi que la antigüedad que le
  // importa al usuario es la de ese crudo, no la del snapshot. Si todavía no hay
  // crudo bajado, cae al timestamp del snapshot.
  const antiguedad = rawSyncedAt ?? lastSyncedAt;

  let text: string;
  if (status === 'partial') {
    text = `sync parcial · ${timeAgo(antiguedad, now)}`;
  } else {
    text = `sync ${timeAgo(antiguedad, now)}`;
  }

  if (mode === 'direct') {
    text += ' · directo';
  }

  return text;
}
