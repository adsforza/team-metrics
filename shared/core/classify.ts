import type { Talla } from './types';

export const PROMPT_SYSTEM = `Sos un experto en DevOps. Clasificá la complejidad de cada issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON array válido, uno por issue en el mismo orden:
[{"talla":"M","confidence":0.85},{"talla":"S","confidence":0.9}]`;

export interface TallaResult { talla: Talla | null; confidence: number; razon: string; }
export type GenerateFn = (prompt: string, opts: { systemInstruction: string; maxOutputTokens: number }) => Promise<string>;

export const validTallas: Talla[] = ['S', 'M', 'L', 'XL'];

export function buildBatchPrompt(issues: Array<{ id: string; title: string; description: string }>): string {
  return issues.map((i, idx) => `${idx + 1}. Title: ${i.title}\nDesc: ${i.description.slice(0, 200)}`).join('\n\n');
}

function fallbackMap(issues: Array<{ id: string }>): Map<string, TallaResult> {
  return new Map(issues.map(i => [i.id, { talla: null as Talla | null, confidence: 0, razon: 'not classified' }]));
}

export function parseBatchResponse(rawText: string, issues: Array<{ id: string }>): Map<string, TallaResult> {
  const text = rawText.trim().replace(/```json|```/g, '').trim();
  let parsed: Array<{ talla?: string; confidence?: number }>;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('Batch parse error:', text.slice(0, 200));
    return fallbackMap(issues);
  }
  const out = new Map<string, TallaResult>();
  issues.forEach((issue, idx) => {
    const p = parsed[idx];
    const confidence = p?.confidence ?? 0;
    const rawTalla = p?.talla as Talla;
    out.set(issue.id, {
      talla: confidence >= 0.6 && validTallas.includes(rawTalla) ? rawTalla : null,
      confidence,
      razon: '',
    });
  });
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function classifyTallaBatch(
  issues: Array<{ id: string; title: string; description: string }>,
  generate: GenerateFn,
  retries = 6,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Map<string, TallaResult>> {
  const prompt = buildBatchPrompt(issues);
  const maxOutputTokens = issues.length * 40;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await generate(prompt, { systemInstruction: PROMPT_SYSTEM, maxOutputTokens });
      return parseBatchResponse(text, issues);
    } catch (err: any) {
      const is429 = err.message?.includes('429') || err.status === 429;
      if (is429 && attempt < retries) {
        const retryMatch = err.message?.match(/"retryDelay":"(\d+)s"/);
        const wait = retryMatch ? (parseInt(retryMatch[1]) + 5) * 1000 : Math.pow(2, attempt + 1) * 60_000;
        console.warn(`Gemini 429 – esperando ${wait / 1000}s (intento ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      console.error('Gemini batch error:', err.message);
      return fallbackMap(issues);
    }
  }
  return fallbackMap(issues);
}
