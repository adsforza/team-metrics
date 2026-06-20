import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockGenerateContent: any;

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: () => ({
        generateContent: (...args: any[]) => mockGenerateContent(...args),
      }),
    })),
  };
});

// Need to import after mock setup
import { classifyTalla, resetClient } from './claude';

describe('classifyTalla', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClient();
  });

  it('returns talla and confidence from Claude response', async () => {
    mockGenerateContent = () => Promise.resolve({
      response: { text: () => '[{"talla":"M","confidence":0.9}]' },
    });

    const result = await classifyTalla('Deploy new auth service', 'Update the auth service to use OAuth2. Requires changes in 2 microservices.');
    expect(result.talla).toBe('M');
    expect(result.confidence).toBe(0.9);
  });

  it('returns null talla when confidence < 0.6', async () => {
    mockGenerateContent = () => Promise.resolve({
      response: { text: () => '[{"talla":"L","confidence":0.4}]' },
    });

    const result = await classifyTalla('Vague task', '');
    expect(result.talla).toBeNull();
    expect(result.confidence).toBe(0.4);
  });
});
