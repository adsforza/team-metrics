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
  // Los números en pantalla salen del crudo (Task 6), asi que la antigüedad que le
  // importa al usuario es la de ese crudo, no la del snapshot. Si todavía no hay
  // crudo bajado, cae al timestamp del snapshot. Vale para las TRES ramas: offline
  // es justo cuando la antigüedad mas importa.
  const antiguedad = rawSyncedAt ?? lastSyncedAt;

  if (status === 'offline') {
    return antiguedad
      ? `⚠ Sin conexión · datos de ${timeAgo(antiguedad, now)}`
      : '⚠ Sin conexión · sin datos aún';
  }
  // Nota: para status 'ok'/'partial', `lastSyncedAt` solo se setea (en el store)
  // cuando `okCount > 0`, que es justo la condicion bajo la que esos status
  // existen — asi que en la practica nunca esta null aca. Se deja el guard sobre
  // `lastSyncedAt` (no `antiguedad`): status === null es "nunca hubo sync real",
  // y eso debe devolver '' aunque el crudo tuviera timestamp por alguna otra via,
  // para no mostrar "sync ..." sin que haya habido una sync real.
  if (!lastSyncedAt) return '';
  // `antiguedad` es non-null aca: si `rawSyncedAt` no estaba, cayo a `lastSyncedAt`,
  // que el guard de arriba ya confirmo no-null. TS no lo infiere solo porque
  // `antiguedad` se calculo antes del guard (lo necesita tambien la rama offline).
  const antiguedadConfirmada: string = antiguedad!;

  let text: string;
  if (status === 'partial') {
    text = `sync parcial · ${timeAgo(antiguedadConfirmada, now)}`;
  } else {
    text = `sync ${timeAgo(antiguedadConfirmada, now)}`;
  }

  if (mode === 'direct') {
    text += ' · directo';
  }

  return text;
}
