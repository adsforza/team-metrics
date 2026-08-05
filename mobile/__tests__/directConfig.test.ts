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
