import { BASE_URL_KEY, DEFAULT_BASE_URL, isServerReachable } from '../lib/api';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

global.fetch = jest.fn();

describe('api constants', () => {
  test('DEFAULT_BASE_URL is localhost:3001', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:3001');
  });

  test('BASE_URL_KEY is a non-empty string', () => {
    expect(typeof BASE_URL_KEY).toBe('string');
    expect(BASE_URL_KEY.length).toBeGreaterThan(0);
  });
});

describe('isServerReachable', () => {
  beforeEach(() => { (global.fetch as jest.Mock) = jest.fn(); });

  test('true cuando /api/config responde ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await expect(isServerReachable()).resolves.toBe(true);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/config');
  });

  test('false cuando el fetch rechaza (offline/timeout)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network'));
    await expect(isServerReachable()).resolves.toBe(false);
  });

  test('false cuando responde no-ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(isServerReachable()).resolves.toBe(false);
  });
});
