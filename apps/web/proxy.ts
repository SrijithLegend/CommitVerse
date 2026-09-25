/**
 * §11.1 — strict CSP with a per-request nonce, plus Supabase session refresh when configured.
 */
import { type NextRequest, NextResponse } from 'next/server';

const origin = (u?: string) => {
  try {
    return u ? new URL(u).origin : '';
  } catch {
    return '';
  }
};

function csp(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const connect = [
    "'self'",
    supabase,
    supabase.replace(/^https/, 'wss'),
    origin(process.env.NEXT_PUBLIC_TILES_BASE_URL),
    origin(process.env.NEXT_PUBLIC_REALTIME_URL),
    origin(process.env.NEXT_PUBLIC_REALTIME_URL).replace(/^https/, 'wss'),
    process.env.NEXT_PUBLIC_POSTHOG_KEY ? 'https://*.posthog.com' : '',
    process.env.NEXT_PUBLIC_SENTRY_DSN ? 'https://*.ingest.sentry.io https://*.ingest.us.sentry.io' : '',
    dev ? 'ws://localhost:* http://localhost:*' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}${process.env.TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https://avatars.githubusercontent.com ${origin(process.env.NEXT_PUBLIC_TILES_BASE_URL)}`.trim(),
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connect}`,
    `frame-src ${process.env.TURNSTILE_SITE_KEY ? 'https://challenges.cloudflare.com' : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://*.paddle.com https://github.com",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = csp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const { createServerClient } = await import('@supabase/ssr');
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const c of cookies) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const c of cookies) response.cookies.set(c.name, c.value, c.options);
        },
      },
    });
    await supabase.auth.getUser();
  }

  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|u/|_next/static|_next/image|favicon.ico|icon|apple-icon|poster|robots.txt|sitemap.xml|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
