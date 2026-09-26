import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { topLogins } from './helpers';

test.describe('§10 API contract & §11 security', () => {
  test('errors are RFC 9457 problem+json', async ({ request }) => {
    const r = await request.get('/api/v1/stars/bad_login!');
    expect(r.status()).toBe(400);
    expect(r.headers()['content-type']).toContain('application/problem+json');
    const p = await r.json();
    expect(p).toMatchObject({ status: 400, code: 'validation_failed' });
  });

  test('auth-only endpoints reject anonymous callers', async ({ request }) => {
    expect((await request.post('/api/v1/signals', { data: { to: 'x' } })).status()).toBe(401);
    expect((await request.post('/api/v1/checkout', { data: { itemId: 'corona.halo_ring' } })).status()).toBe(401);
    expect((await request.get('/api/admin/bakes')).status()).toBe(401);
  });

  test('strict CSP with a nonce and security headers on pages', async ({ request }) => {
    const r = await request.get('/leaderboards');
    const csp = r.headers()['content-security-policy']!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers()['strict-transport-security']).toContain('max-age=');
    expect(r.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('README embed is an escaped, script-free SVG', async ({ request }) => {
    const [login] = await topLogins(request, 1);
    const r = await request.get(`/api/embed/${login}.svg?theme=light&size=sm`);
    expect(r.headers()['content-type']).toContain('image/svg+xml');
    const svg = await r.text();
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain(`@${login}`);
  });

  test('universe tiles are immutable and versioned', async ({ request }) => {
    const u = await (await request.get('/api/v1/universe/current')).json();
    const m = await request.get(u.manifestUrl);
    expect(m.headers()['cache-control']).toContain('immutable');
    const manifest = await m.json();
    expect(manifest.counts.stars).toBeGreaterThan(0);
  });

  test('a11y: no serious or critical axe violations on key pages', async ({ page }) => {
    // accessible list mode (F19): the DOM under test is the same, and axe isn't starved by the SwiftShader render loop
    await page.addInitScript(() => localStorage.setItem('cv-settings', JSON.stringify({ state: { listMode: true }, version: 1 })));
    for (const path of ['/leaderboards', '/achievements', '/chart?list=1', '/legal/privacy']) {
      await page.goto(path);
      // not 'networkidle': the live SSE stream keeps a request open on every page
      await page.waitForLoadState('load');
      await expect(page.locator('main')).not.toBeEmpty();
      const r = await new AxeBuilder({ page }).exclude('canvas').analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${path}: ${v.id} — ${v.help}`)).toEqual([]);
    }
  });
});
