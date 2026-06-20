import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Talla } from '../types';

const PROMPT_SYSTEM = `Sos un experto en DevOps. Clasificá la complejidad de cada issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON array válido, uno por issue en el mismo orden:
[{"talla":"M","confidence":0.85},{"talla":"S","confidence":0.9}]`;

export interface TallaResult {
  talla: Talla | null;
  confidence: number;
  razon: string;
}

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _client;
}

export function resetClient(): void {
  _client = null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const validTallas: Talla[] = ['S', 'M', 'L', 'XL'];

export async function classifyTallaBatch(
  issues: Array<{ id: string; title: string; description: string }>,
  retries = 6
): Promise<Map<string, TallaResult>> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
  const fallback = new Map(issues.map(i => [i.id, { talla: null, confidence: 0, razon: 'not classified' }]));

  const prompt = issues.map((i, idx) =>
    `${idx + 1}. Title: ${i.title}\nDesc: ${i.description.slice(0, 200)}`
  ).join('\n\n');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const model = getClient().getGenerativeModel({
        model: modelName,
        systemInstruction: PROMPT_SYSTEM,
        generationConfig: { maxOutputTokens: issues.length * 40 },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim().replace(/```json|```/g, '').trim();

      let parsed: Array<{ talla?: string; confidence?: number }>;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.error('Batch parse error:', text.slice(0, 200));
        return fallback;
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
      return fallback;
    }
  }
  return fallback;
}

// Mantener compatibilidad con sync.ts existente
export async function classifyTalla(title: string, description: string): Promise<TallaResult> {
  const results = await classifyTallaBatch([{ id: '_', title, description }]);
  return results.get('_') ?? { talla: null, confidence: 0, razon: 'error' };
}
