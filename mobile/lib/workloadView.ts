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

// Umbral unico de "sin arrancar" (T, en dias): lo consume tanto ageColor (colores)
// como useRequesterDetail (computeRequesterDetail) y la tira de resumen de la pantalla
// de detalle. Un solo lugar para que un cambio de umbral no desalinee colores y texto.
export const AGING_THRESHOLD_DAYS = 7;

// Color de la antiguedad por umbral, multiplos de thresholdDays (T): gris hasta 2T,
// naranja entre 2T y 8T, rojo por encima de 8T.
export function ageColor(edadDias: number, thresholdDays = AGING_THRESHOLD_DAYS): string {
  if (edadDias > thresholdDays * 8) return Colors.error;
  if (edadDias > thresholdDays * 2) return Colors.warning;
  return Colors.textMuted;
}

// Contrato de URL del drill-down por solicitante, compartido entre carga.tsx (que
// codifica al navegar) y app/requester/[board]/[requester].tsx (que lo lee). Vive aca,
// no como literal duplicado en cada punta: asi fallo una vez esta feature ('sin-dato'
// vs '__null__', ver commit cba027e) y no vuelve a pasar en silencio.
export const NULL_BUCKET = '__null__';

export function encodeRequesterSegment(requester: string | null): string {
  return requester === null ? NULL_BUCKET : encodeURIComponent(requester);
}

// El segmento se codifica al navegar; expo-router lo decodifica solo al leerlo,
// asi que aca NO hay que volver a decodificar: hacerlo rompe los nombres con % literal
// (p.ej. "100% Digital" -> URIError) y corrompe los que tienen %20 (resuelve a otro
// requester y muestra lista vacia en silencio).
export function parseRequesterSegment(segment: string | undefined): string | null {
  return !segment || segment === NULL_BUCKET ? null : segment;
}
