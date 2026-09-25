'use client';
/** F20 admin console: moderation queue, users, orders/refunds, bakes (trigger/rollback), flags & kill switches, events, drops, audit log. */
import { Button, Tabs } from '@commitverse/ui-kit';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiProblem, api } from '@/lib/client/api';
import { toast } from './Toaster';

const A = (path: string, init?: Parameters<typeof api>[1]) => api<Record<string, unknown>>(`/api/admin/${path}`, init);
const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
  try {
    await fn();
    toast(ok);
    after?.();
  } catch (e) {
    toast(e instanceof ApiProblem ? e.message : 'Failed', { tone: 'error' });
  }
};
const KILL_SWITCHES = ['comets', 'multiplayer', 'shop', 'materialize'];

function Json({ data }: { data: unknown }) {
  return <pre className="max-h-96 overflow-auto rounded bg-[rgba(160,190,255,0.05)] p-3 font-mono text-[11px] text-[var(--ink-2)] scroll-thin">{JSON.stringify(data, null, 2)}</pre>;
}

function Moderation() {
  const { data, refetch } = useQuery({ queryKey: ['adm-mod'], queryFn: () => A('moderation') });
  const banners = (data?.banners as { github_id: number; login: string; text: string }[]) ?? [];
  const reports = (data?.reports as { id: number; target_type: string; target_id: string; reason: string }[]) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="label mb-2">Banners awaiting review ({banners.length})</h3>
        {banners.map((b) => (
          <div key={b.github_id} className="flex items-center justify-between border-t border-[var(--panel-border)] py-2 text-sm">
            <span>
              @{b.login}: <span className="font-mono text-[var(--ink-1)]">“{b.text}”</span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => run(() => A('moderation/banner', { method: 'POST', json: { githubId: b.github_id, decision: 'approved' } }), 'Approved', refetch)}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => run(() => A('moderation/banner', { method: 'POST', json: { githubId: b.github_id, decision: 'rejected' } }), 'Rejected', refetch)}>
                Reject
              </Button>
            </span>
          </div>
        ))}
      </div>
      <div>
        <h3 className="label mb-2">Open reports ({reports.length})</h3>
        {reports.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t border-[var(--panel-border)] py-2 text-sm">
            <span>
              {r.target_type} {r.target_id} — {r.reason}
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => run(() => A(`reports/${r.id}`, { method: 'POST', json: { status: 'actioned' } }), 'Actioned', refetch)}>
                Actioned
              </Button>
              <Button size="sm" variant="quiet" onClick={() => run(() => A(`reports/${r.id}`, { method: 'POST', json: { status: 'dismissed' } }), 'Dismissed', refetch)}>
                Dismiss
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Users() {
  const [login, setLogin] = useState('');
  const [item, setItem] = useState('');
  const [alias, setAlias] = useState('');
  const { data, refetch } = useQuery({ queryKey: ['adm-user', login], queryFn: () => A(`users/${login}`), enabled: false });
  const act = (action: string, json?: unknown) => run(() => A(`users/${login}/${action}`, { method: 'POST', json }), `${action} done`, refetch);
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void refetch();
        }}
      >
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="login" className="glass h-9 px-3 font-mono text-sm outline-none" aria-label="Login" />
        <Button type="submit" size="sm">
          Look up
        </Button>
      </form>
      {data && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {['refresh', 'reset-cosmetics', 'ban', 'unban', 'hide'].map((a) => (
              <Button key={a} size="sm" variant={a === 'ban' || a === 'hide' ? 'danger' : 'ghost'} onClick={() => act(a)}>
                {a}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => act('review', { underReview: true })}>
              flag under review
            </Button>
          </div>
          <div className="flex gap-2">
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="item id to grant" className="glass h-9 px-3 font-mono text-sm outline-none" />
            <Button size="sm" onClick={() => act('grant-item', { itemId: item })}>
              Grant
            </Button>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="old login → redirect" className="glass h-9 px-3 font-mono text-sm outline-none" />
            <Button size="sm" onClick={() => act('alias', { oldLogin: alias })}>
              Add alias
            </Button>
          </div>
          <Json data={data} />
        </div>
      )}
    </div>
  );
}

function Orders() {
  const { data, refetch } = useQuery({ queryKey: ['adm-orders'], queryFn: () => A('orders') });
  const orders = (data?.orders as { id: string; buyer: string; recipient: string; item_id: string; status: string; amount_minor: number; currency: string; created_at: string }[]) ?? [];
  return (
    <table className="w-full text-sm">
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-t border-[var(--panel-border)]">
            <td className="py-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
            <td>@{o.buyer}{o.recipient !== o.buyer ? ` → @${o.recipient}` : ''}</td>
            <td>{o.item_id}</td>
            <td className="font-mono">{(o.amount_minor / 100).toFixed(2)} {o.currency}</td>
            <td>{o.status}</td>
            <td className="text-right">
              {o.status === 'paid' && (
                <span className="flex justify-end gap-2">
                  <Button size="sm" variant="danger" onClick={() => run(() => A(`orders/${o.id}/refund`, { method: 'POST' }), 'Refunded', refetch)}>
                    Refund
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => run(() => A(`orders/${o.id}/regrant`, { method: 'POST' }), 'Re-granted', refetch)}>
                    Re-grant
                  </Button>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Bakes() {
  const { data, refetch } = useQuery({ queryKey: ['adm-bakes'], queryFn: () => A('bakes'), refetchInterval: 10_000 });
  const runs = (data?.runs as { version: string; status: string; started_at: string; stats: Record<string, unknown> | null }[]) ?? [];
  return (
    <div className="space-y-3">
      <Button size="sm" variant="primary" onClick={() => run(() => A('bakes', { method: 'POST' }), 'Bake queued', refetch)}>
        Trigger bake
      </Button>
      <table className="w-full text-sm">
        <tbody>
          {runs.map((r) => (
            <tr key={r.version} className="border-t border-[var(--panel-border)]">
              <td className="py-2 font-mono text-xs">{r.version}</td>
              <td>{r.status}</td>
              <td className="font-mono text-xs text-[var(--ink-3)]">{r.stats ? `${r.stats.stars ?? ''} stars · ${r.stats.durationMs ?? ''} ms` : ''}</td>
              <td className="text-right">
                {(r.status === 'retired' || r.status === 'validated') && (
                  <Button size="sm" variant="quiet" onClick={() => run(() => A('bakes/rollback', { method: 'POST', json: { version: r.version } }), 'Rolled back', refetch)}>
                    Roll back to this
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Json data={{ delta: data?.delta, budget: data?.budget, queue: data?.queue, cost: data?.cost }} />
    </div>
  );
}

function FlagsAndEvents() {
  const { data, refetch } = useQuery({ queryKey: ['adm-flags'], queryFn: () => A('flags') });
  const { data: ev, refetch: refetchEv } = useQuery({ queryKey: ['adm-events'], queryFn: () => A('events') });
  const flags = new Map(((data?.flags as { key: string; enabled: boolean }[]) ?? []).map((f) => [f.key, f.enabled]));
  const [name, setName] = useState('Hacktoberfest meteor shower');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  return (
    <div className="space-y-5">
      <div>
        <h3 className="label mb-2">Kill switches</h3>
        {KILL_SWITCHES.map((k) => {
          const off = flags.get(`kill.${k}`) === true;
          return (
            <div key={k} className="flex items-center justify-between border-t border-[var(--panel-border)] py-2 text-sm">
              <span>{k}</span>
              <Button size="sm" variant={off ? 'primary' : 'danger'} onClick={() => run(() => A('flags', { method: 'POST', json: { key: `kill.${k}`, enabled: !off } }), 'Updated', refetch)}>
                {off ? 'Re-enable' : 'Kill'}
              </Button>
            </div>
          );
        })}
      </div>
      <div>
        <h3 className="label mb-2">Schedule a meteor shower</h3>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="glass h-9 px-3 text-sm outline-none" aria-label="Name" />
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="glass h-9 px-2 text-sm" aria-label="Starts" />
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="glass h-9 px-2 text-sm" aria-label="Ends" />
          <Button
            size="sm"
            disabled={!start || !end}
            onClick={() =>
              run(
                () => A('events', { method: 'POST', json: { type: 'meteor_shower', name, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() } }),
                'Scheduled',
                refetchEv,
              )
            }
          >
            Schedule
          </Button>
        </div>
        <Json data={ev?.events} />
      </div>
    </div>
  );
}

function Audit() {
  const { data } = useQuery({ queryKey: ['adm-audit'], queryFn: () => A('audit') });
  return <Json data={data?.log} />;
}

export function AdminConsole() {
  const [tab, setTab] = useState('moderation');
  return (
    <section className="glass p-5">
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'moderation', label: 'Moderation' },
          { value: 'users', label: 'Users' },
          { value: 'orders', label: 'Orders' },
          { value: 'bakes', label: 'Bakes' },
          { value: 'flags', label: 'Flags & events' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      <div className="mt-4">
        {tab === 'moderation' && <Moderation />}
        {tab === 'users' && <Users />}
        {tab === 'orders' && <Orders />}
        {tab === 'bakes' && <Bakes />}
        {tab === 'flags' && <FlagsAndEvents />}
        {tab === 'audit' && <Audit />}
      </div>
    </section>
  );
}
