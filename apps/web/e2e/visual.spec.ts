import { expect, type Page, test } from '@playwright/test';
import { waitForUniverse } from './helpers';

/**
 * §13.1 visual regression: deterministic frames via `?freeze=1&t=12.5` (fixed scene clock, fixed-step camera, DPR 1,
 * High tier, no adaptive quality) rendered by SwiftShader. Baselines are per-platform. Generate them on the Linux CI
 * image (`--update-snapshots`, uploaded as an artifact) and commit them. Threshold: 0.5% of pixels.
 */
test.describe.configure({ mode: 'serial' });

const SHOT = { maxDiffPixelRatio: 0.005, animations: 'disabled' as const, caret: 'hide' as const };

type Row = { login: string; spectralClass: string; galaxy: string };
let rows: Row[] = [];

test.beforeAll(async ({ request }) => {
  const r = await request.get('/api/v1/leaderboards/global?metric=impact');
  rows = ((await r.json()) as { rows: Row[] }).rows;
});

/** Canvas-only screenshot once the rig has settled into orbit (or a fixed frame count for wide shots). */
async function frame(page: Page, url: string, settle: 'orbit' | number) {
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}freeze=1&t=12.5`);
  await waitForUniverse(page);
  await page.waitForFunction(
    (s) => {
      const e = (window as unknown as { __cv: { frame: number; rig: { mode: string } } }).__cv;
      return s === 'orbit' ? e.rig.mode === 'orbit' && e.frame > 30 : e.frame > s;
    },
    settle,
    { timeout: 90_000 },
  );
  // HUD and DOM overlays vary with data; the regression target is the rendered universe
  return page.locator('canvas').first();
}

test('supercluster hero', async ({ page }) => {
  await expect(await frame(page, '/', 60)).toHaveScreenshot('hero.png', SHOT);
});

test('galaxy view', async ({ page }) => {
  const g = rows[0]!.galaxy;
  await expect(await frame(page, `/galaxy/${encodeURIComponent(g)}`, 'orbit')).toHaveScreenshot('galaxy.png', SHOT);
});

for (const cls of ['O', 'B', 'A', 'F', 'G', 'K', 'M']) {
  test(`star system · spectral class ${cls}`, async ({ page }) => {
    const star = rows.find((r) => r.spectralClass === cls);
    test.skip(!star, `no ${cls}-class star in this universe`);
    await expect(await frame(page, `/@${star!.login}`, 'orbit')).toHaveScreenshot(`class-${cls}.png`, SHOT);
  });
}
