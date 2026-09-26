/** Browser Sentry (§13.2): errors + WebGL context-loss reports carry the GPU bucket. No-op without a DSN. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({ dsn, tracesSampleRate: 0.05, replaysSessionSampleRate: 0 });
  });
}

export {};
