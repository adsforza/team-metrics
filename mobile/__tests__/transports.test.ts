let mockGenerateContent: any;
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: (cfg: any) => ({ _cfg: cfg, generateContent: (...a: any[]) => mockGenerateContent(...a) }),
  })),
}));

import { jiraHttpFetch, makeGeminiGenerate, fetchBoardNameDirect } from '../lib/transports';

describe('jiraHttpFetch', () => {
  it('builds URL with params + Basic auth header and returns json', async () => {
    let capturedUrl = ''; let capturedInit: any = null;
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      capturedUrl = url; capturedInit = init;
      return { ok: true, json: async () => ({ issues: [], total: 0 }) };
    });
    const data = await jiraHttpFetch({ url: 'https://x.atlassian.net/rest/agile/1.0/board/7/issue', auth: { username: 'e@t.com', password: 'tok' }, params: { jql: 'project = OPS', startAt: 0 } });
    expect(data).toEqual({ issues: [], total: 0 });
    expect(capturedUrl).toContain('jql=project');
    expect(capturedInit.headers.Authorization).toBe('Basic ' + Buffer.from('e@t.com:tok').toString('base64'));
  });

  it('throws Jira API error (status) on non-ok', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({ errorMessages: ['rate'] }) }));
    await expect(jiraHttpFetch({ url: 'u', auth: { username: 'e', password: 't' }, params: {} }))
      .rejects.toThrow(/Jira API error \(429\)/);
  });
});

describe('fetchBoardNameDirect', () => {
  const cfg = { baseUrl: 'https://x.atlassian.net', email: 'e@t.com',
                apiToken: 'tok', projectKey: 'DPP', boardId: 9534 };

  it('devuelve el nombre del board', async () => {
    const http = jest.fn(async () => ({ name: 'Black Team Infra' })) as any;
    expect(await fetchBoardNameDirect(cfg, http)).toBe('Black Team Infra');
    expect(http.mock.calls[0][0].url).toContain('/rest/agile/1.0/board/9534');
  });

  it('devuelve null si Jira falla, sin propagar el error', async () => {
    const http = jest.fn(async () => { throw new Error('boom'); }) as any;
    await expect(fetchBoardNameDirect(cfg, http)).resolves.toBeNull();
  });

  it('devuelve null si name no es un string', async () => {
    const http = jest.fn(async () => ({ name: { value: 'raro' } })) as any;
    expect(await fetchBoardNameDirect(cfg, http)).toBeNull();
  });
});

describe('makeGeminiGenerate', () => {
  it('calls generateContent with the model config and returns text', async () => {
    mockGenerateContent = jest.fn(async () => ({ response: { text: () => '[{"talla":"M","confidence":0.9}]' } }));
    const gen = makeGeminiGenerate('key123', 'gemini-flash-lite-latest');
    const out = await gen('prompt', { systemInstruction: 'sys', maxOutputTokens: 40 });
    expect(out).toBe('[{"talla":"M","confidence":0.9}]');
    expect(mockGenerateContent).toHaveBeenCalledWith('prompt');
  });
});
