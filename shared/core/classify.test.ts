import { describe, it, expect } from 'vitest';
import { buildBatchPrompt, parseBatchResponse, classifyTallaBatch } from './classify';
import type { GenerateFn } from './classify';

const issues = [
  { id: 'A', title: 'Deploy auth', description: 'x'.repeat(300) },
  { id: 'B', title: 'Fix typo', description: 'trivial' },
];

describe('buildBatchPrompt', () => {
  it('numbers issues, truncates description to 200 chars, joins with blank line', () => {
    const p = buildBatchPrompt(issues);
    expect(p).toContain('1. Title: Deploy auth');
    expect(p).toContain('2. Title: Fix typo');
    expect(p).toContain('Desc: ' + 'x'.repeat(200) + '\n'); // truncated to 200
    expect(p).not.toContain('x'.repeat(201));
    expect(p.split('\n\n')).toHaveLength(2);
  });
});

describe('parseBatchResponse', () => {
  it('maps talla/confidence and strips code fences', () => {
    const raw = '```json\n[{"talla":"M","confidence":0.9},{"talla":"S","confidence":0.8}]\n```';
    const out = parseBatchResponse(raw, issues);
    expect(out.get('A')).toEqual({ talla: 'M', confidence: 0.9, razon: '' });
    expect(out.get('B')).toEqual({ talla: 'S', confidence: 0.8, razon: '' });
  });
  it('nulls talla when confidence < 0.6 or talla invalid, keeping confidence', () => {
    const raw = '[{"talla":"L","confidence":0.4},{"talla":"Z","confidence":0.9}]';
    const out = parseBatchResponse(raw, issues);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0.4, razon: '' });
    expect(out.get('B')).toEqual({ talla: null, confidence: 0.9, razon: '' });
  });
  it('returns fallback map on invalid JSON', () => {
    const out = parseBatchResponse('not json', issues);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
    expect(out.get('B')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
  });
});

const two = [
  { id: 'A', title: 'a', description: '' },
  { id: 'B', title: 'b', description: '' },
];

describe('classifyTallaBatch', () => {
  it('happy path: calls generate once and parses', async () => {
    let calls = 0;
    const generate: GenerateFn = async () => { calls++; return '[{"talla":"M","confidence":0.9},{"talla":"L","confidence":0.7}]'; };
    const out = await classifyTallaBatch(two, generate);
    expect(calls).toBe(1);
    expect(out.get('A')?.talla).toBe('M');
    expect(out.get('B')?.talla).toBe('L');
  });

  it('retries on 429 (parsing retryDelay) then succeeds, using injected sleep', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    let n = 0;
    const generate: GenerateFn = async () => {
      if (n++ === 0) { const e: any = new Error('[429 Too Many Requests] "retryDelay":"3s"'); throw e; }
      return '[{"talla":"S","confidence":0.9},{"talla":"S","confidence":0.9}]';
    };
    const out = await classifyTallaBatch(two, generate, 6, sleep);
    expect(n).toBe(2);              // failed once, retried once
    expect(waits).toEqual([8000]);  // (3 + 5) * 1000
    expect(out.get('A')?.talla).toBe('S');
  });

  it('non-429 error returns fallback without retrying', async () => {
    let calls = 0;
    const generate: GenerateFn = async () => { calls++; throw new Error('boom'); };
    const out = await classifyTallaBatch(two, generate, 6, async () => {});
    expect(calls).toBe(1);
    expect(out.get('A')).toEqual({ talla: null, confidence: 0, razon: 'not classified' });
  });
});
