/** F14 — README embed: /api/embed/:login.svg?theme=dark|light&size=sm|md. Animated SVG, no JS, everything escaped. */
import { LOGIN_RE } from '@commitverse/contracts';
import { renderEmbed } from '@commitverse/embed';
import { db } from '@/lib/server/app';
import { resolveLogin, starDetail } from '@/lib/server/stars';

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const file = (await ctx.params).file;
  const login = file.replace(/\.svg$/i, '');
  if (!LOGIN_RE.test(login)) return new Response('Bad login', { status: 400 });
  const url = new URL(req.url);
  const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
  const size = url.searchParams.get('size') === 'sm' ? 'sm' : 'md';
  const d = await db();
  const u = await resolveLogin(d, login);
  if (!u || u.optedOut) return new Response('Not found', { status: u?.optedOut ? 410 : 404 });
  const s = await starDetail(d, u.githubId);
  const svg = renderEmbed(
    {
      login: s.user.login,
      name: s.user.name,
      temperature: s.body.temperature,
      spectralClass: s.body.spectralClass,
      subclass: s.body.subclass,
      state: s.body.state,
      radius: s.body.radius,
      cTotal: s.metrics.cTotal,
      c30: s.metrics.c30,
      starsTotal: s.metrics.starsTotal,
      galaxy: s.body.galaxy.language,
      planets: s.planets.map((p) => ({ color: p.languageColor, orbit: p.orbitRadius, period: p.period, size: p.radius })),
      pulsar: s.body.flags.includes('pulsar'),
    },
    theme,
    size,
  );
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}
