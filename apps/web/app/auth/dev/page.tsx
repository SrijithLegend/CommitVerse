/** Local-mode sign-in (no Supabase configured). Production uses GitHub OAuth via Supabase; this page 404s there. */

import { hasGitHubCredentials } from '@commitverse/pipeline';
import { notFound } from 'next/navigation';
import { db, localMode } from '@/lib/server/app';

export default async function DevSignIn({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; next?: string; error?: string; login?: string }>;
}) {
  if (!localMode()) notFound();
  const sp = await searchParams;
  const samples = await (await db()).query<{ login: string }>(
    'select u.login::text as login from bodies b join github_users u using (github_id) order by b.impact desc limit 6',
  );
  const remove = sp.intent === 'remove';
  return (
    <div className="pointer-events-auto flex min-h-dvh items-center justify-center px-4">
      <form action="/auth/dev/login" method="post" className="glass w-full max-w-sm p-6">
        <div className="label">Local development sign-in</div>
        <h1 className="mt-1 text-lg font-semibold text-[var(--ink-1)]">{remove ? 'Prove it’s you to remove your star' : 'Claim a star'}</h1>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          Production signs in with GitHub (scope <code className="font-mono">read:user</code>). Locally, pick any mapped star
          {hasGitHubCredentials() ? ' or any real GitHub user.' : '.'}
        </p>
        {sp.error && (
          <p className="mt-3 text-sm text-[var(--danger)]">
            {sp.error === 'unknown' ? `@${sp.login} isn’t mapped here.` : 'Invalid username.'}
          </p>
        )}
        <input type="hidden" name="intent" value={remove ? 'remove' : 'claim'} />
        <input type="hidden" name="next" value={sp.next ?? '/'} />
        <label htmlFor="login" className="mt-4 block text-sm text-[var(--ink-1)]">
          GitHub username
        </label>
        <input
          id="login"
          name="login"
          required
          pattern="@?[a-zA-Z0-9\-]{1,39}"
          className="glass mt-1 h-10 w-full px-3 font-mono text-sm outline-none"
          placeholder={samples[0]?.login ?? 'octocat'}
        />
        <button type="submit" className="mt-4 h-10 w-full rounded-[10px] bg-[var(--accent)] text-sm font-medium text-[var(--space-0)]">
          {remove ? 'Continue' : 'Sign in & claim'}
        </button>
        {samples.length > 0 && (
          <p className="mt-4 text-xs text-[var(--ink-3)]">
            Try:{' '}
            {samples.map((s) => (
              <code key={s.login} className="mr-2 font-mono text-[var(--ink-2)]">
                {s.login}
              </code>
            ))}
          </p>
        )}
      </form>
    </div>
  );
}
