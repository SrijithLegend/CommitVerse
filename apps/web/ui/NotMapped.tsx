'use client';
import { Button } from '@commitverse/ui-kit';
import { useRouter } from 'next/navigation';
import { goToStar } from './Search';

export function NotMapped({ login, invalid }: { login: string; invalid: boolean }) {
  const router = useRouter();
  return (
    <div className="glass pointer-events-auto max-w-sm p-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--ink-1)]">
        {invalid ? 'That isn’t a GitHub username' : `@${login} isn’t in the universe yet`}
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-2)]">
        {invalid ? 'Usernames are 1–39 letters, numbers or dashes.' : 'We can form this star right now from public GitHub data.'}
      </p>
      {!invalid && (
        <Button className="mt-5" variant="primary" onClick={() => void goToStar(router, login)}>
          Form @{login}’s star
        </Button>
      )}
    </div>
  );
}
