import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL_KEY = 'base_url';
export const JIRA_BASE_URL_KEY = 'jira_base_url';
export const DEFAULT_BASE_URL = 'http://localhost:3001';

export async function getBaseUrl(): Promise<string> {
  return (await AsyncStorage.getItem(BASE_URL_KEY)) ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(BASE_URL_KEY, url.trim());
}

export async function apiFetch<T>(path: string): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

// Dispara la reclasificación en el server. El endpoint responde al instante
// (status: 'started') y clasifica en segundo plano, limitado por la cuota de Gemini.
export async function triggerReclassify(): Promise<{ status: string; pending: number }> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/sync/reclassify`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} /api/sync/reclassify`);
  return res.json() as Promise<{ status: string; pending: number }>;
}

export async function pushTallas(
  tallas: { id: string; talla: string; confidence: number }[],
): Promise<{ updated: number }> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/tallas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tallas),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} /api/tallas`);
  return res.json() as Promise<{ updated: number }>;
}

export async function isServerReachable(): Promise<boolean> {
  const base = await getBaseUrl();
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
