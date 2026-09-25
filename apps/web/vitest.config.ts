import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    env: { NODE_ENV: 'test', DATA_DIR: ':memory:', PAYMENT_PROVIDER: 'mock', STRIPE_WEBHOOK_SECRET: 'whsec_test', LOG_LEVEL: 'silent' },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
