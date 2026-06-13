import Anthropic from '@anthropic-ai/sdk';
import type { Talla } from '../types';

const PROMPT_SYSTEM = `Sos un experto en DevOps. Clasificá la complejidad de este issue de Jira
como S, M, L o XL según estas definiciones:
- S (Simple): cambio de configuración, fix trivial, tarea de 1 paso
- M (Moderado): cambio con algunos pasos, impacta 1-2 servicios
- L (Complejo): requiere coordinación, impacta múltiples sistemas o tiene riesgo
- XL (Muy complejo): migración, incidente mayor, trabajo de semanas

Respondé SOLO con un JSON válido: {"talla": "M", "confidence": 0.85, "razon": "..."}`;

export interface TallaResult {
  talla: Talla | null;
  confidence: number;
  razon: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY! });
  return _client;
}

export function resetClient(): void {
  _client = null;
}

export async function classifyTalla(title: string, description: string): Promise<TallaResult> {
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

  try {
    const msg = await getClient().messages.create({
      model,
      max_tokens: 128,
      system: PROMPT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Issue: ${title}\nDescripción: ${description.slice(0, 500)}`,
      }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
    let parsed: { talla?: string; confidence?: number; razon?: string };

    try {
      parsed = JSON.parse(text);
    } catch {
      return { talla: null, confidence: 0, razon: 'parse error' };
    }

    const confidence = parsed.confidence ?? 0;
    const rawTalla = parsed.talla as Talla;
    const validTallas: Talla[] = ['S', 'M', 'L', 'XL'];

    return {
      talla: confidence >= 0.6 && validTallas.includes(rawTalla) ? rawTalla : null,
      confidence,
      razon: parsed.razon ?? '',
    };
  } catch (err: any) {
    console.error('Claude API error:', err.message);
    return { talla: null, confidence: 0, razon: 'api error' };
  }
}
