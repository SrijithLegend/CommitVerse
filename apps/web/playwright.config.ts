import { defineConfig, devices } from '@playwright/test';

/**
 * §13.1 E2E. Locally runs against the zero-config local mode (embedded Postgres, synthetic universe, dev sign-in,
 * mock payments). CI points BASE_URL at a Vercel preview + Supabase branch DB and uses bundled Chromium + SwiftShader.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/warmup.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // SwiftShader WebGL is CPU-bound; parallel pages starve each other's frames
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome', viewport: { width: 1440, height: 900 } },
      testIgnore: /visual\.spec/,
    },
    // §13.1 visual regression — deterministic frames; always bundled Chromium so baselines don't depend on the local Chrome
    {
      name: 'visual',
      testMatch: /visual\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' },
      grep: /@mobile/,
      testIgnore: /visual\.spec/,
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 240_000 },
});
