import { expect, type Page, test } from '@playwright/test';
import { waitForUniverse } from './helpers';

/**
 * §13.1 visual regression: deterministic frames via `?freeze=1&t=12.5` (fixed scene clock, fixed-step camera, DPR 1,
 * High tier, no adaptive quality) rendered by SwiftShader. Baselines are per-platform. Generate them on the Linux CI
 * image (`--update-snapshots`, uploaded as an artifact) and commit them. Threshold: 0.5% of pixels.
 */
test.describe.configure({ timeout: 480_000 }); // SwiftShader renders a few fps

const SHOT = { maxDiffPixelRatio: 0.005, animations: 'disabled' as const, caret: 'hide' as const };

type Row = { login: string; spectralClass: string; galaxy: string };
let rows: Row[] = [];

test.beforeAll(async ({ request }) => {
  const r = await request.get('/api/v1/leaderboards/global?metric=impact');
  rows = ((await r.json()) as { rows: Row[] }).rows;
});

/** Canvas-only screenshot once the camera has settled: in orbit around a star, or (wide shots) any warp finished. */
async function frame(page: Page, url: string, settle: 'orbit' | 'still') {
  // labels off: star names come from data, not rendering
  await page.addInitScript(() => localStorage.setItem('cv-settings', JSON.stringify({ state: { labels: false }, version: 1 })));
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}freeze=1&t=12.5`);
  await waitForUniverse(page);
  await page.waitForFunction(
    (s) => {
      const e = (window as unknown as { __cv: { frame: number; rig: { mode: string; warpAmount: number } } }).__cv;
      if (e.frame < 60 || e.rig.mode === 'warp' || e.rig.warpAmount > 0.001) return false;
      return s === 'still' || e.rig.mode === 'orbit';
    },
    settle,
    { timeout: 300_000 },
  );
  // stop simulating (camera, tiles) so consecutive frames are identical; toHaveScreenshot waits for two equal captures
  await page.evaluate(() => {
    (window as unknown as { __cv: { paused: boolean } }).__cv.paused = true;
  });
  // HUD and DOM overlays vary with data; the regression target is the rendered universe
  await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
  return page.locator('canvas').first();
}

test('supercluster hero', async ({ page }) => {
  await expect(await frame(page, '/', 'still')).toHaveScreenshot('hero.png', SHOT);
});

test('galaxy view', async ({ page }) => {
  const g = rows[0]!.galaxy;
  await expect(await frame(page, `/galaxy/${encodeURIComponent(g)}`, 'still')).toHaveScreenshot('galaxy.png', SHOT);
});

for (const cls of ['O', 'B', 'A', 'F', 'G', 'K', 'M']) {
  test(`star system · spectral class ${cls}`, async ({ page }) => {
    const star = rows.find((r) => r.spectralClass === cls);
    test.skip(!star, `no ${cls}-class star in this universe`);
    await expect(await frame(page, `/@${star!.login}`, 'orbit')).toHaveScreenshot(`class-${cls}.png`, SHOT);
  });
}
