// Drives /bench (§12 scripted flight) in a real Chrome and prints the result JSON for perf/RESULTS.md.
//   pnpm --filter @commitverse/web bench [baseUrl] [tier=high] [--swiftshader]
// --gpu (default) uses the machine's GPU in a visible window; --swiftshader is the CI CPU-side budget run.
import { chromium } from '@playwright/test';

const [base = 'http://localhost:3000', tier = 'high'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const swiftshader = process.argv.includes('--swiftshader');
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : 'chrome',
  headless: swiftshader,
  args: swiftshader ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript((q) => localStorage.setItem('cv-settings', JSON.stringify({ state: { quality: q }, version: 1 })), tier);
await page.goto(`${base}/bench`);
await page.waitForFunction(() => window.__cv && window.__cv.frame > 30 && window.__cv.tiles.stats.loadedNodes > 0, undefined, {
  timeout: 180_000,
});
await page.getByRole('button', { name: 'Run benchmark' }).click();
await page.waitForFunction(() => window.__benchResult, undefined, { timeout: 180_000 });
const result = await page.evaluate(() => window.__benchResult);
console.log(JSON.stringify({ ...result, viewport: '1920x1080', dpr: await page.evaluate(() => devicePixelRatio) }, null, 2));
await browser.close();
