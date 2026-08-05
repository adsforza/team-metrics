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
): string {
  if (status === 'offline') {
    return lastSyncedAt
      ? `⚠ Sin conexión · datos de ${timeAgo(lastSyncedAt, now)}`
      : '⚠ Sin conexión · sin datos aún';
  }
  if (!lastSyncedAt) return '';

  let text: string;
  if (status === 'partial') {
    text = `sync parcial · ${timeAgo(lastSyncedAt, now)}`;
  } else {
    text = `sync ${timeAgo(lastSyncedAt, now)}`;
  }

  if (mode === 'direct') {
    text += ' · directo';
  }

  return text;
}
