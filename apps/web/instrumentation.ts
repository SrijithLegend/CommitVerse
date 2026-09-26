/** Sentry for the server/edge runtimes (§13.2). No-op unless SENTRY_DSN is set. */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    beforeSend(event) {
      const scrub = (s?: string) =>
        s?.replace(/(gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|cvb_[A-Za-z0-9_-]{20,}|Bearer\s+\S+)/g, '[redacted]');
      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) ex.value = scrub(ex.value);
      if (event.request?.headers) delete event.request.headers.authorization;
      return event;
    },
  });
}

export async function onRequestError(...args: unknown[]) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
