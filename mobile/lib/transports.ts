import type { JiraHttp } from '@teammetrics/core/jira';
import type { GenerateFn } from '@teammetrics/core/classify';
import { GoogleGenerativeAI } from '@google/generative-ai';

function base64(input: string): string {
  const g = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(input);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++);
    const c2 = input.charCodeAt(i++);
    const c3 = input.charCodeAt(i++);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    let e3 = ((c2 & 15) << 2) | (c3 >> 6);
    let e4 = c3 & 63;
    if (isNaN(c2)) { e3 = 64; e4 = 64; }
    else if (isNaN(c3)) { e4 = 64; }
    output += chars.charAt(e1) + chars.charAt(e2)
      + (e3 === 64 ? '=' : chars.charAt(e3))
      + (e4 === 64 ? '=' : chars.charAt(e4));
  }
  return output;
}

export const jiraHttpFetch: JiraHttp = async ({ url, auth, params }) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const full = `${url}?${qs.toString()}`;
  const token = base64(`${auth.username}:${auth.password}`);
  const res = await fetch(full, {
    headers: { Authorization: `Basic ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body: any = await res.json(); if (body?.errorMessages?.length) msg = body.errorMessages.join(', '); } catch { /* ignore */ }
    throw new Error(`Jira API error (${res.status}): ${msg}`);
  }
  return res.json();
};

// Alias "-latest": Google retira las versiones fijas (gemini-2.0-flash-lite dejó de
// existir y devolvía 404), el alias siempre apunta al flash-lite vigente.
export function makeGeminiGenerate(apiKey: string, model = 'gemini-flash-lite-latest'): GenerateFn {
  const client = new GoogleGenerativeAI(apiKey);
  return async (prompt, { systemInstruction, maxOutputTokens }) => {
    const m = client.getGenerativeModel({ model, systemInstruction, generationConfig: { maxOutputTokens } });
    const result = await m.generateContent(prompt);
    return result.response.text();
  };
}
