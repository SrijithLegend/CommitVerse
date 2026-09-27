import { describe, expect, it } from 'vitest';
import { PRODUCTION_REQUIRED, parseServerEnv } from '../src/env';

const full = Object.fromEntries(PRODUCTION_REQUIRED.map((k) => [k, k === 'APP_URL' ? 'https://cv.test' : 'x'])) as Record<string, string>;
const prod: Record<string, string | undefined> = {
  ...full,
  NODE_ENV: 'production',
  PAYMENT_PROVIDER: 'stripe',
  TOKEN_ENC_ACTIVE_KID: 'k1',
  TOKEN_ENC_KEY_k1: 'x',
};

describe('§15 env validation', () => {
  it('boots in production when everything required is set', () => {
    expect(parseServerEnv(prod).APP_URL).toBe('https://cv.test');
  });

  it('refuses production without APP_URL even though the schema has a localhost default', () => {
    const { APP_URL: _, ...rest } = prod;
    expect(() => parseServerEnv(rest)).toThrow(/APP_URL/);
  });

  it('refuses mock payments and a missing active encryption key in production', () => {
    expect(() => parseServerEnv({ ...prod, PAYMENT_PROVIDER: 'mock' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => parseServerEnv({ ...prod, TOKEN_ENC_KEY_k1: undefined })).toThrow(/TOKEN_ENC_ACTIVE_KID/);
  });

  it('local mode needs nothing', () => {
    expect(parseServerEnv({}).APP_URL).toBe('http://localhost:3000');
  });
});
