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
    // SwiftShader (CPU WebGL) by default, identical everywhere. E2E_GPU=1 uses the local GPU instead: same tests, but not
    // at the mercy of CPU throttling. Never set it for the visual project; its baselines are SwiftShader renders.
    launchOptions: {
      args: process.env.E2E_GPU
        ? ['--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome', viewport: { width: 1440, height: 900 } },
      testIgnore: /visual\.spec/,
    },
    // §13.1 visual regression — deterministic frames. Baselines are per platform: CI's bundled Chromium writes the
    // committed …-linux.png files; local runs use installed Chrome and write their own platform's (uncommitted) files.
    {
      name: 'visual',
      testMatch: /visual\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
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
