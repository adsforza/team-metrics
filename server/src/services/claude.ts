import { GoogleGenerativeAI } from '@google/generative-ai';
import { classifyTallaBatch as coreClassifyTallaBatch } from '../../../shared/core/classify';
import type { TallaResult, GenerateFn } from '../../../shared/core/classify';

export type { TallaResult };

let _client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _client;
}
export function resetClient(): void { _client = null; }

const geminiGenerate: GenerateFn = async (prompt, { systemInstruction, maxOutputTokens }) => {
  const model = getClient().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
    systemInstruction,
    generationConfig: { maxOutputTokens },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
};

export function classifyTallaBatch(
  issues: Array<{ id: string; title: string; description: string }>,
  retries = 6,
): Promise<Map<string, TallaResult>> {
  return coreClassifyTallaBatch(issues, geminiGenerate, retries);
}

// Mantener compatibilidad con sync.ts existente
export async function classifyTalla(title: string, description: string): Promise<TallaResult> {
  const results = await classifyTallaBatch([{ id: '_', title, description }]);
  return results.get('_') ?? { talla: null, confidence: 0, razon: 'error' };
}
