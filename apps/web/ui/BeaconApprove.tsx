'use client';
import { Button } from '@commitverse/ui-kit';
import { useState } from 'react';
import { ApiProblem, api } from '@/lib/client/api';
import { useMe } from './Providers';

export function BeaconApprove({ initialCode }: { initialCode: string }) {
  const { data: me } = useMe();
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  if (!me?.claimed)
    return (
      <div className="glass p-5 text-sm text-[var(--ink-2)]">
        Claim your star first, then come back to approve the extension.{' '}
        <a className="text-[var(--accent)]" href={`/auth/signin?next=${encodeURIComponent(`/beacon?code=${initialCode}`)}`}>
          Sign in
        </a>
      </div>
    );
  return (
    <form
      className="glass p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('beacon/device/approve', { method: 'POST', json: { userCode: code.trim().toUpperCase() } });
          setState('ok');
        } catch (err) {
          setState('error');
          setMsg(err instanceof ApiProblem ? err.message : 'Failed');
        }
      }}
    >
      <p className="text-sm text-[var(--ink-2)]">
        Enter the code shown in VS Code. The Beacon token can only send heartbeats — the language you’re editing, nothing else.
      </p>
      <div className="mt-4 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" aria-label="Device code" className="glass h-10 w-40 px-3 font-mono tracking-widest outline-none" />
        <Button variant="primary" type="submit">
          Approve
        </Button>
      </div>
      {state === 'ok' && <p className="mt-3 text-sm text-[var(--accent)]">Connected. Your star will pulse cyan while you code.</p>}
      {state === 'error' && <p className="mt-3 text-sm text-[var(--danger)]">{msg}</p>}
    </form>
  );
}
