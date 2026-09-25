'use client';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void import('@sentry/nextjs').then((S) => S.captureException(error)).catch(() => {});
  }, [error]);
  return (
    <div className="pointer-events-auto flex min-h-dvh items-center justify-center px-4">
      <div className="glass max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold text-[var(--ink-1)]">A solar storm hit this page</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">Something went wrong on our side. It has been reported.</p>
        <button type="button" onClick={reset} className="mt-4 text-sm text-[var(--accent)]">
          Try again
        </button>
      </div>
    </div>
  );
}
