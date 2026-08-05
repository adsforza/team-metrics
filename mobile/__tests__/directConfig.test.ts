jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    __store: store,
  };
});

import { getDirectConfigFields, setDirectConfigFields, getDirectConfig } from '../lib/directConfig';
import * as SecureStore from 'expo-secure-store';

const mockStore = (SecureStore as unknown as { __store: Record<string, string> }).__store;

describe('directConfig', () => {
  it('round-trips fields', async () => {
    await setDirectConfigFields({ baseUrl: 'https://x.atlassian.net/', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardIds: '7, 9', geminiKey: 'gk' });
    const f = await getDirectConfigFields();
    expect(f.email).toBe('e@t.com');
    expect(f.boardIds).toBe('7, 9');
  });

  it('getDirectConfig assembles boards (normalizing baseUrl)', async () => {
    const cfg = await getDirectConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.geminiKey).toBe('gk');
    expect(cfg!.boards).toHaveLength(2);
    expect(cfg!.boards[0]).toEqual({ baseUrl: 'https://x.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 7 });
    expect(cfg!.boards[1]).toEqual({ baseUrl: 'https://x.atlassian.net', email: 'e@t.com', apiToken: 'tok', projectKey: 'OPS', boardId: 9 });
  });
});

describe('directConfig (trim de credenciales)', () => {
  it('recorta espacios/newlines del token y demás campos (fix del 401)', async () => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    await setDirectConfigFields({
      baseUrl: 'https://z.atlassian.net/',
      email: '  e@t.com ',
      apiToken: 'ATATT-token\n',
      projectKey: ' OPS ',
      boardIds: '5',
      geminiKey: ' gk ',
    });
    // trim en escritura
    expect(mockStore['JIRA_API_TOKEN']).toBe('ATATT-token');
    expect(mockStore['JIRA_EMAIL']).toBe('e@t.com');
    // y el config ensamblado queda limpio
    const cfg = await getDirectConfig();
    expect(cfg!.boards[0].apiToken).toBe('ATATT-token');
    expect(cfg!.boards[0].email).toBe('e@t.com');
    expect(cfg!.boards[0].projectKey).toBe('OPS');
    expect(cfg!.geminiKey).toBe('gk');
  });

  it('getDirectConfig recorta valores ya guardados sucios (defensa en lectura)', async () => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    // simula secure-store con un token que quedó guardado con espacio final
    mockStore['JIRA_BASE_URL'] = 'https://z.atlassian.net';
    mockStore['JIRA_EMAIL'] = 'e@t.com';
    mockStore['JIRA_API_TOKEN'] = 'dirty-token ';
    mockStore['JIRA_PROJECT_KEY'] = 'OPS';
    mockStore['JIRA_BOARD_IDS'] = '5';
    mockStore['GEMINI_API_KEY'] = 'gk';
    const cfg = await getDirectConfig();
    expect(cfg!.boards[0].apiToken).toBe('dirty-token');
  });
});

describe('directConfig (incomplete)', () => {
  it('getDirectConfig returns null when some fields are missing', async () => {
    // Wipe the shared in-memory store so no field lingers from prior tests, then
    // populate only a subset of fields to get a genuinely incomplete config.
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    await setDirectConfigFields({ baseUrl: 'https://y.atlassian.net', email: 'partial@t.com' });
    const cfg = await getDirectConfig();
    expect(cfg).toBeNull();
  });
});
