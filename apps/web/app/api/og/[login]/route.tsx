/** F14 — OG image (Satori via next/og). Star sprite by class + state, stats overlay. CDN-cached 6 h, versioned by bake. */
import { Login } from '@commitverse/contracts';
import { kelvinToHex } from '@commitverse/universe-core';
import { ImageResponse } from 'next/og';
import { db } from '@/lib/server/app';
import { resolveLogin, starDetail } from '@/lib/server/stars';

const fmt = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export async function GET(_req: Request, ctx: { params: Promise<{ login: string }> }) {
  const parsed = Login.safeParse((await ctx.params).login);
  const d = await db();
  const u = parsed.success ? await resolveLogin(d, parsed.data) : null;
  if (!u || u.optedOut) return new Response('Not found', { status: u?.optedOut ? 410 : 404 });
  const s = await starDetail(d, u.githubId);
  const color = kelvinToHex(s.body.temperature);
  const size = 120 + s.body.radius * 26;
  const stateLabel = s.body.state === 'main' ? 'main sequence' : s.body.state.replace('_', ' ');
  return new ImageResponse(
    <div
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        background: '#03040a',
        color: '#e8ecf6',
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 330 - size * 1.6,
          top: 315 - size * 1.6,
          width: size * 3.2,
          height: size * 3.2,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}cc 0%, ${color}33 22%, ${color}00 60%)`,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 330 - size / 2,
          top: 315 - size / 2,
          width: size,
          height: size,
          borderRadius: '50%',
          background: `radial-gradient(circle at 42% 40%, #ffffff 0%, ${color} 45%, ${color} 70%, ${color}aa 100%)`,
          boxShadow: `0 0 80px ${color}`,
          display: 'flex',
        }}
      />
      {s.planets.slice(0, 8).map((p, i) => {
        const r = size / 2 + 40 + i * 28;
        const a = p.phase;
        return (
          <div
            key={p.repoId}
            style={{
              position: 'absolute',
              left: 330 + Math.cos(a) * r - 6,
              top: 315 + Math.sin(a) * r * 0.45 - 6,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: p.languageColor,
              display: 'flex',
            }}
          />
        );
      })}
      <div style={{ position: 'absolute', left: 660, top: 120, display: 'flex', flexDirection: 'column', width: 500 }}>
        <div style={{ fontSize: 22, color: '#9aa4bd', letterSpacing: 4 }}>COMMITVERSE</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 16, lineHeight: 1.05 }}>{s.user.name ?? s.user.login}</div>
        <div style={{ fontSize: 28, color: '#9aa4bd', marginTop: 8 }}>
          @{s.user.login} · {s.body.galaxy.language} galaxy
        </div>
        <div style={{ fontSize: 34, color, marginTop: 28 }}>
          {s.body.subclass} · {stateLabel}
          {s.body.flags.includes('pulsar') ? ' · pulsar' : ''}
        </div>
        <div style={{ display: 'flex', marginTop: 40, gap: 40 }}>
          {[
            ['CONTRIBUTIONS', fmt(s.metrics.cTotal)],
            ['30 DAYS', fmt(s.metrics.c30)],
            ['STARS', fmt(s.metrics.starsTotal)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 18, color: '#5b6480', letterSpacing: 3 }}>{k}</div>
              <div style={{ fontSize: 44, marginTop: 6 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', right: 40, bottom: 28, fontSize: 18, color: '#5b6480' }}>Not affiliated with GitHub, Inc.</div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
        etag: `"${s.bakeVersion}-${u.githubId}"`,
      },
    },
  );
}
