import { expect, test } from '@playwright/test';
import { topLogins, waitForUniverse } from './helpers';

test.describe('F21 landing + F1/F2 explore', () => {
  test('landing paints, the universe renders, and the footer disclaimer is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Every developer is a star.' })).toBeVisible();
    await expect(page.getByText('Not affiliated with or endorsed by GitHub, Inc.')).toBeVisible();
    await waitForUniverse(page);
    const stars = await page.evaluate(
      () => (window as unknown as { __cv: { tiles: { stats: { loadedPoints: number } } } }).__cv.tiles.stats.loadedPoints,
    );
    expect(stars).toBeGreaterThan(1000);
  });

  test('search → warp → system panel for a known star', async ({ page, request }) => {
    const [login] = await topLogins(request, 1);
    await page.goto('/');
    await waitForUniverse(page);
    const box = page.getByRole('combobox').first();
    await box.fill(login!.slice(0, 8));
    await expect(page.getByRole('option').first()).toBeVisible();
    await box.fill(login!);
    await box.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/@${login}$`));
    await expect(page.getByRole('complementary', { name: 'System panel' }).getByText(`@${login}`, { exact: true })).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { __cv: { rig: { mode: string } } }).__cv.rig.mode === 'orbit', undefined, {
      timeout: 60_000, // the rig clamps dt to 0.1 s, so a warp is ~5× slower in wall time at SwiftShader frame rates
    });
  });

  test('profile SSR: title, description, JSON-LD, OG image', async ({ page, request }) => {
    const [login] = await topLogins(request, 1);
    await page.goto(`/@${login}`);
    await expect(page).toHaveTitle(new RegExp(`@${login}'s star system`));
    const ld = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(ld!)['@type']).toBe('ProfilePage');
    const og = await request.get(`/api/og/${login}`);
    expect(og.headers()['content-type']).toContain('image/png');
  });

  test('unknown users get the "form this star" flow; invalid logins are rejected', async ({ page }) => {
    await page.goto('/@this-user-does-not-exist-x9');
    await expect(page.getByText('isn’t in the universe yet')).toBeVisible();
    await page.goto('/@bad_login!');
    await expect(page.getByText('That isn’t a GitHub username')).toBeVisible();
  });

  test('galaxy view, star chart and list mode', async ({ page }) => {
    await page.goto('/chart?list=1');
    await expect(page.getByRole('grid', { name: /Stars, ranked by impact/ })).toBeVisible();
    await page.getByRole('grid').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[role=row][aria-selected=true]')).toHaveCount(1);
  });

  test('keyboard help overlay lists remappable shortcuts @mobile', async ({ page, isMobile }) => {
    await page.goto('/');
    if (isMobile) {
      await expect(page.getByRole('heading', { name: 'Every developer is a star.' })).toBeVisible();
      return;
    }
    await waitForUniverse(page);
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible();
    await expect(page.getByText('Toggle flight')).toBeVisible();
  });
});
