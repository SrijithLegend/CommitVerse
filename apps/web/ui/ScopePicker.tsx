'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ScopePicker({ scope, galaxies }: { scope: string; galaxies: { id: number; language: string }[] }) {
  const router = useRouter();
  const [org, setOrg] = useState(scope.startsWith('org:') ? scope.slice(4) : '');
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Scope"
        value={scope.startsWith('org:') ? 'org' : scope}
        onChange={(e) => e.target.value !== 'org' && router.push(`/leaderboards?scope=${encodeURIComponent(e.target.value)}`)}
        className="glass h-9 px-3 text-sm text-[var(--ink-1)]"
      >
        <option value="global">Global</option>
        {galaxies.map((g) => (
          <option key={g.id} value={`galaxy:${g.id}`}>
            {g.language} galaxy
          </option>
        ))}
        <option value="org">Constellation (org)…</option>
      </select>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[a-zA-Z0-9-]{1,39}$/.test(org)) router.push(`/leaderboards?scope=org:${org}`);
        }}
      >
        <input
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          placeholder="org login"
          aria-label="Organisation"
          className="glass h-9 w-36 px-3 font-mono text-sm outline-none"
        />
      </form>
    </div>
  );
}
