import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockCreateFn: any;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockImplementation(() => mockCreateFn()),
      },
    })),
  };
});

// Need to import after mock setup
import Anthropic from '@anthropic-ai/sdk';
import { classifyTalla, resetClient } from './claude';

describe('classifyTalla', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClient();
  });

  it('returns talla and confidence from Claude response', async () => {
    mockCreateFn = () => Promise.resolve({
      content: [{ type: 'text', text: '{"talla":"M","confidence":0.9,"razon":"Impacta 2 servicios"}' }],
    });

    const result = await classifyTalla('Deploy new auth service', 'Update the auth service to use OAuth2. Requires changes in 2 microservices.');
    expect(result.talla).toBe('M');
    expect(result.confidence).toBe(0.9);
  });

  it('returns null talla when confidence < 0.6', async () => {
    mockCreateFn = () => Promise.resolve({
      content: [{ type: 'text', text: '{"talla":"L","confidence":0.4,"razon":"unclear"}' }],
    });

    const result = await classifyTalla('Vague task', '');
    expect(result.talla).toBeNull();
    expect(result.confidence).toBe(0.4);
  });
});
