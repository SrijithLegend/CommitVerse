import { expect, test } from '@playwright/test';
import { devSignIn, unclaimedLogins, waitForUniverse } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('F5 claim · F6/F7 shop & payments · F8 signal · §11.4 opt-out', () => {
  let me: string;
  let other: string;
  let leaver: string;

  test.beforeAll(async ({ request }) => {
    // fresh, unclaimed stars below the top 10 (the search/profile tests use the top of the board)
    [me, other, leaver] = (await unclaimedLogins(request, 3)) as [string, string, string];
  });

  test('claim → ignition → my star', async ({ page }) => {
    await devSignIn(page, me);
    await expect(page).toHaveURL(new RegExp(`/@${me}\\?ignite=1`));
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  });

  test('buy a premium cosmetic through checkout; the webhook grants it; equip it', async ({ page }) => {
    await devSignIn(page, me);
    await page.goto('/shop');
    await page.getByRole('button', { name: /Halo Ring/ }).click();
    await page.getByRole('button', { name: /^Buy / }).click();
    await expect(page.getByText('Test checkout · local mode')).toBeVisible();
    await page.getByRole('button', { name: 'Pay (test)' }).click();
    await expect(page).toHaveURL(/status=success/);
    const inv = await page.request.get('/api/v1/me');
    const j = (await inv.json()) as { inventory: { itemId: string }[] };
    expect(j.inventory.some((i) => i.itemId === 'corona.halo_ring')).toBeTruthy();
    await page.getByRole('button', { name: /Halo Ring/ }).click();
    await page.getByRole('button', { name: 'Equip' }).click();
    await expect(page.getByText('Equipped')).toBeVisible();
  });

  test('send a signal from the system panel', async ({ page }) => {
    await devSignIn(page, me);
    await page.goto(`/@${other}`);
    const panel = page.getByRole('complementary', { name: 'System panel' });
    await panel.getByRole('button', { name: /Signal/ }).click();
    await page.getByLabel('Message').fill('love your work');
    await page.getByRole('button', { name: 'Send signal' }).click();
    await expect(page.getByText(`Signal sent to @${other}`)).toBeVisible();
  });

  test('cosmetic integrity: no item changes the physical axes', async ({ page }) => {
    await devSignIn(page, me);
    await page.goto(`/@${me}`);
    await waitForUniverse(page);
    const read = () =>
      page.evaluate(() => {
        type U = { value: number };
        const e = (
          window as unknown as {
            __cv: {
              pickables: Set<{ userData: { kind?: string }; material: { uniforms: Record<string, U> }; parent: { scale: { x: number } } }>;
            };
          }
        ).__cv;
        const star = [...e.pickables].find((o) => o.userData.kind === 'star');
        if (!star) return null;
        const u = star.material.uniforms;
        return { T: u.uTemp!.value, state: u.uState!.value, intensity: u.uIntensity!.value, radius: star.parent.scale.x };
      });
    await expect.poll(read, { timeout: 30_000 }).not.toBeNull();
    const base = await read();
    const items = (await (await page.request.get('/api/v1/shop/items')).json()) as { items: { id: string; slot: string }[] };
    for (const it of items.items) {
      await page.evaluate(({ slot, id }) => {
        const s = (window as unknown as { __cvStore: { getState: () => { set: (p: object) => void } } }).__cvStore;
        s.getState().set({ tryOn: { [slot]: id } });
      }, it);
      await page.waitForTimeout(120);
      expect(await read(), `item ${it.id}`).toEqual(base);
    }
  });

  test('remove my star → 410 Gone, and it cannot re-form', async ({ page, request }) => {
    await devSignIn(page, leaver, 'remove');
    await expect(page).toHaveURL(/confirm=remove/);
    await page.getByRole('button', { name: 'Remove permanently' }).click();
    await expect(page).toHaveURL(/\/$/);
    const r = await request.get(`/@${leaver}`, { maxRedirects: 5 });
    expect(r.status()).toBe(410);
    const m = await request.post(`/api/v1/stars/${leaver}/materialize`);
    expect(m.status()).toBe(410);
  });
});
