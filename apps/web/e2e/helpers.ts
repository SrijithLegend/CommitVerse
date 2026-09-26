import { type APIRequestContext, expect, type Page } from '@playwright/test';

export async function topLogins(request: APIRequestContext, n = 5): Promise<string[]> {
  const r = await request.get('/api/v1/leaderboards/global?metric=impact');
  expect(r.ok()).toBeTruthy();
  const j = (await r.json()) as { rows: { login: string }[] };
  return j.rows.slice(0, n).map((x) => x.login);
}

/**
 * `n` stars nobody has claimed yet, from the lower half of the board. The local DB persists between runs, so tests
 * that claim, buy or remove need fresh stars each time.
 */
export async function unclaimedLogins(request: APIRequestContext, n: number): Promise<string[]> {
  const all = (await topLogins(request, 50)).slice(10);
  const out: string[] = [];
  for (const login of all.sort(() => Math.random() - 0.5)) {
    const r = await request.get(`/api/v1/stars/${login}`);
    if (r.ok() && !((await r.json()) as { social: { claimed: boolean } }).social.claimed) out.push(login);
    if (out.length === n) return out;
  }
  throw new Error(`fewer than ${n} unclaimed stars left — reset local data (rm -r .data)`);
}

/** Waits until the 3D engine has rendered frames (SwiftShader in CI). */
export async function waitForUniverse(page: Page) {
  await page.waitForFunction(
    () => {
      const e = (window as unknown as { __cv?: { frame: number; tiles: { stats: { loadedNodes: number } } } }).__cv;
      return !!e && e.frame > 5 && e.tiles.stats.loadedNodes > 0;
    },
    undefined,
    { timeout: 60_000 },
  );
}

/** Local-mode dev sign-in (production uses GitHub OAuth). Claims the star. */
export async function devSignIn(page: Page, login: string, intent: 'claim' | 'remove' = 'claim') {
  await page.goto(`/auth/dev?intent=${intent}`);
  await page.getByLabel('GitHub username', { exact: true }).fill(login);
  await page.getByRole('button', { name: intent === 'remove' ? 'Continue' : 'Sign in & claim' }).click();
}
