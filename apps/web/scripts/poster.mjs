// Renders the landing LCP poster (public/poster.avif) and the site-wide OG image (public/opengraph.png) from the app
// itself: a deterministic `?freeze=1` frame of the live universe. Run against a running app:
//   pnpm --filter @commitverse/web poster [baseUrl]
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const base = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// no star labels: the poster must not feature particular people
await page.addInitScript(() => localStorage.setItem('cv-settings', JSON.stringify({ state: { labels: false }, version: 1 })));
await page.goto(`${base}/?freeze=1&t=12.5`);
await page.waitForFunction(
  () => window.__cv && window.__cv.frame > 60 && window.__cv.tiles.stats.loadedNodes > 0 && window.__cv.rig.warpAmount < 0.001,
  undefined,
  { timeout: 300_000 },
);
// only the universe: hide the HUD, labels and page chrome that sit over the canvas
await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
await page.waitForTimeout(500);
const png = await page.locator('canvas').first().screenshot();
await browser.close();

await sharp(png).avif({ quality: 50, effort: 6 }).toFile('public/poster.avif');

const title = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="url(#g)"/>
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#03040a" stop-opacity=".85"/><stop offset=".6" stop-color="#03040a" stop-opacity="0"/></linearGradient></defs>
  <text x="72" y="270" font-family="Inter Tight, Inter, Arial, sans-serif" font-size="26" letter-spacing="6" fill="#9aa4bd">COMMITVERSE</text>
  <text x="72" y="350" font-family="Inter Tight, Inter, Arial, sans-serif" font-size="68" font-weight="700" fill="#e8ecf6">Every developer is a star.</text>
  <text x="72" y="410" font-family="Inter Tight, Inter, Arial, sans-serif" font-size="28" fill="#9aa4bd">A live universe generated from public GitHub activity.</text>
  <text x="1128" y="600" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#5b6480">Not affiliated with GitHub, Inc.</text>
</svg>`);
await sharp(png)
  .resize(1200, 630, { fit: 'cover' })
  .composite([{ input: title }])
  .png({ compressionLevel: 9 })
  .toFile('public/opengraph.png');
console.log('wrote public/poster.avif and public/opengraph.png');
