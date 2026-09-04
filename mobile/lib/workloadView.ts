import type { WorkloadRequester } from '@teammetrics/core/workload';
import { Colors } from './theme';

export interface SplitRequesters {
  top: WorkloadRequester[];
  rest: WorkloadRequester[];
  restPedidos: number;
  restPendientes: number;
  maxPedidos: number;
}

// Corta la lista en el top visible y el resto agrupado. La cola es larga (~29
// solicitantes por squad), asi que el resto se colapsa detras de "Otros N equipos".
export function splitRequesters(requesters: WorkloadRequester[], topN = 3): SplitRequesters {
  const top = requesters.slice(0, topN);
  const rest = requesters.slice(topN);
  return {
    top, rest,
    restPedidos: rest.reduce((s, r) => s + r.pedidos, 0),
    restPendientes: rest.reduce((s, r) => s + r.pendientes, 0),
    maxPedidos: requesters.reduce((m, r) => Math.max(m, r.pedidos), 0),
  };
}

// Ancho de la barra proporcional al solicitante mas grande del squad.
export function barPct(pedidos: number, maxPedidos: number): number {
  return maxPedidos > 0 ? Math.round((pedidos / maxPedidos) * 100) : 0;
}

// Color de la antiguedad por umbral, multiplos de AGING_THRESHOLD_DAYS (T, default 7):
// gris hasta 2T, naranja entre 2T y 8T, rojo por encima de 8T.
export function ageColor(edadDias: number, thresholdDays = 7): string {
  if (edadDias > thresholdDays * 8) return Colors.error;
  if (edadDias > thresholdDays * 2) return Colors.warning;
  return Colors.textMuted;
}
