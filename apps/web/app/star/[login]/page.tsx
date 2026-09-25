/**
 * F4 profile `/@login` (rewritten to /star/[login]): SSR for SEO — title, description from the 3 axes, JSON-LD
 * ProfilePage, robots (index claimed + top 50k by impact), 301 for renamed logins, 410 for opted-out stars.
 * Above the fold: the live 3D system (the persistent canvas); below: stats, heatmap, planets, achievements…
 */
import { LOGIN_RE } from '@commitverse/contracts';
import { spectralSubclass } from '@commitverse/universe-core';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { permanentRedirect, redirect } from 'next/navigation';
import { db } from '@/lib/server/app';
import { resolveLogin, starDetail } from '@/lib/server/stars';
import { NotMapped } from '@/ui/NotMapped';
import { ProfileDetails } from '@/ui/ProfileDetails';
import { SceneIntent } from '@/ui/SceneIntent';

type Props = { params: Promise<{ login: string }>; searchParams: Promise<{ focus?: string; ignite?: string }> };

async function load(login: string) {
  if (!LOGIN_RE.test(login)) return { kind: 'invalid' as const };
  const d = await db();
  const u = await resolveLogin(d, login);
  if (!u) return { kind: 'unmapped' as const };
  if (u.optedOut) return { kind: 'gone' as const };
  if (u.redirectedFrom) return { kind: 'alias' as const, login: u.login };
  try {
    return { kind: 'ok' as const, detail: await starDetail(d, u.githubId) };
  } catch {
    return { kind: 'unmapped' as const };
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const login = decodeURIComponent((await params).login);
  const r = await load(login);
  if (r.kind !== 'ok') return { title: `@${login}`, robots: { index: false } };
  const s = r.detail;
  const state = s.body.state === 'main' ? 'main-sequence' : s.body.state.replace('_', ' ');
  const description = `${spectralSubclass(s.body.temperature)} ${state} star in the ${s.body.galaxy.language} galaxy — ${s.metrics.cTotal.toLocaleString()} contributions (radius), ${s.metrics.c30.toLocaleString()} in the last 30 days (temperature), ${s.metrics.starsTotal.toLocaleString()} stars and ${s.metrics.followers.toLocaleString()} followers (luminosity).`;
  const indexable = s.social.claimed || (s.body.rankGlobal !== null && s.body.rankGlobal <= 50_000);
  return {
    title: `@${s.user.login}'s star system`,
    description,
    alternates: { canonical: `/@${s.user.login}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: `@${s.user.login}'s star system · Commitverse`, description, images: [`/api/og/${s.user.login}?v=${s.bakeVersion}`] },
    twitter: { card: 'summary_large_image', images: [`/api/og/${s.user.login}?v=${s.bakeVersion}`] },
  };
}

export default async function StarPage({ params, searchParams }: Props) {
  const login = decodeURIComponent((await params).login);
  const sp = await searchParams;
  const r = await load(login);
  if (r.kind === 'alias') permanentRedirect(`/@${r.login}`);
  if (r.kind === 'gone') redirect(`/gone?login=${encodeURIComponent(login)}`);
  if (r.kind !== 'ok') {
    return (
      <section className="flex min-h-dvh items-center justify-center px-5">
        <SceneIntent intent={{ type: 'hero' }} />
        <NotMapped login={login} invalid={r.kind === 'invalid'} />
      </section>
    );
  }
  const s = r.detail;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: s.user.name ?? s.user.login,
      alternateName: `@${s.user.login}`,
      identifier: String(s.user.githubId),
      image: s.user.avatarUrl ?? undefined,
      description: s.user.bio ?? undefined,
      sameAs: s.fetchedAt ? [`https://github.com/${s.user.login}`] : undefined,
    },
  };
  return (
    <>
      <SceneIntent intent={{ type: 'star', login: s.user.login, planet: sp.focus ?? null, ignite: sp.ignite === '1' }} />
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning>
        {JSON.stringify(jsonLd).replace(/</g, '\\u003c')}
      </script>
      <div className="h-[100dvh]" aria-hidden />
      <ProfileDetails detail={s} />
    </>
  );
}
