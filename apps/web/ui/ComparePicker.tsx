'use client';
import { Button } from '@commitverse/ui-kit';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ComparePicker({ first }: { first: string }) {
  const router = useRouter();
  const [a, setA] = useState(first);
  const [b, setB] = useState('');
  const ok = (s: string) => /^[a-zA-Z0-9-]{1,39}$/.test(s.replace(/^@/, ''));
  return (
    <form
      className="glass flex flex-wrap items-end gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok(a) && ok(b)) router.push(`/compare/${a.replace(/^@/, '')}/${b.replace(/^@/, '')}`);
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-[var(--ink-2)]">
        First star
        <input
          value={a}
          onChange={(e) => setA(e.target.value)}
          className="glass h-10 px-3 font-mono text-[var(--ink-1)] outline-none"
          placeholder="@login"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--ink-2)]">
        Second star
        <input
          value={b}
          onChange={(e) => setB(e.target.value)}
          className="glass h-10 px-3 font-mono text-[var(--ink-1)] outline-none"
          placeholder="@login"
        />
      </label>
      <Button variant="primary" type="submit" disabled={!ok(a) || !ok(b)}>
        Compare
      </Button>
    </form>
  );
}
