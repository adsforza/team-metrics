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
