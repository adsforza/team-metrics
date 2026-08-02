import { describe, it, expect } from 'vitest';
import { buildBatchPrompt, parseBatchResponse } from './classify';

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
