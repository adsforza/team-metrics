import { BASE_URL_KEY, DEFAULT_BASE_URL } from '../lib/api';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('api constants', () => {
  test('DEFAULT_BASE_URL is localhost:3001', () => {
    expect(DEFAULT_BASE_URL).toBe('http://localhost:3001');
  });

  test('BASE_URL_KEY is a non-empty string', () => {
    expect(typeof BASE_URL_KEY).toBe('string');
    expect(BASE_URL_KEY.length).toBeGreaterThan(0);
  });
});
