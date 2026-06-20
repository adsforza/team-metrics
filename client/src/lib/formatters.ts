import type { Talla } from '../../../server/src/types';

export function formatDays(days: number | null): string {
  if (days === null) return '—';
  return days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

export const TALLA_COLOR: Record<Talla, string> = {
  S: '#86efac',
  M: '#93c5fd',
  L: '#c4b5fd',
  XL: '#fca5a5',
};

export const TALLA_BG: Record<Talla, string> = {
  S: 'bg-green-900 text-green-300',
  M: 'bg-blue-900 text-blue-300',
  L: 'bg-purple-900 text-purple-300',
  XL: 'bg-red-900 text-red-300',
};

export function agePillClass(days: number): string {
  if (days >= 7) return 'bg-red-900 text-red-300';
  if (days >= 3) return 'bg-amber-900 text-amber-300';
  return 'bg-green-900 text-green-300';
}
