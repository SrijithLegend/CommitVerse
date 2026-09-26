import { request } from '@playwright/test';

/**
 * `next dev` compiles each route on first hit, and that can take longer than an assertion timeout under parallel workers.
 * Compiling the routes the specs visit up front keeps timing assertions (e.g. search → warp) meaningful.
 * No-op against a deployed preview (BASE_URL), where everything is prebuilt.
 */
export default async function warmup() {
  if (process.env.BASE_URL) return;
  const api = await request.newContext({ baseURL: 'http://localhost:3000', timeout: 180_000 });
  const lb = await (await api.get('/api/v1/leaderboards/global?metric=impact')).json();
  const login = lb.rows[0].login as string;
  for (const path of [
    '/',
    `/@${login}`,
    '/@this-user-does-not-exist-x9',
    '/shop',
    '/leaderboards',
    '/achievements',
    '/chart?list=1',
    '/legal/privacy',
    '/auth/dev?intent=claim',
    '/checkout/mock',
    `/api/v1/stars/${login}`,
    `/api/og/${login}`,
    `/api/embed/${login}.svg`,
    '/api/v1/shop/items',
    '/api/v1/universe/current',
    '/api/v1/search?q=a',
  ])
    await api.get(path, { maxRedirects: 0 }).catch(() => {});
  await api.post(`/api/v1/stars/${login}/materialize`).catch(() => {});
  await api.post('/api/v1/webhooks/mock', { data: {} }).catch(() => {}); // 400 (unsigned), but now compiled
  await api.post('/checkout/mock/complete', { form: { order: 'x' } }).catch(() => {});
  await api.get('/shop?status=success').catch(() => {});
  await api.dispose();
}
