'use client';
/**
 * F6 shop: grid with filters (slot, rarity, earnable vs premium), live preview on your own star ("Try on" — visible
 * only to you), limited-drop countdowns, owned %, redeem with Stardust or buy (Stripe/Paddle Checkout), equip.
 * Hard rule surfaced to users: cosmetics never change the physical axes.
 */
import type { ShopItem } from '@commitverse/contracts';
import { Button, compact, Dialog, fmt } from '@commitverse/ui-kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Api, ApiProblem } from '@/lib/client/api';
import { useUniverse } from '@/stores/universe';
import { useMe } from './Providers';
import { toast } from './Toaster';

const RARITY_COLOR: Record<string, string> = { common: '#9aa4bd', rare: '#7cc4ff', epic: '#b48cff', legendary: '#e8c268', mythic: '#ff8fb1' };
const SLOTS = ['all', 'corona', 'aura', 'star_rings', 'star_skin', 'planet_skin', 'ship', 'trail', 'warp', 'banner', 'signal_style'];

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Date.parse(until) - now;
  if (ms <= 0) return <span>ended</span>;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return <span className="num font-mono">{d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`} left</span>;
}

function Swatch({ item }: { item: ShopItem }) {
  const c = item.renderConfig as Record<string, string | number>;
  const a = String(c.color ?? c.colorA ?? RARITY_COLOR[item.rarity]);
  const b = String(c.colorB ?? a);
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-[radial-gradient(circle_at_50%_60%,#0b1224,#03040a)]">
      <div className="absolute h-20 w-20 rounded-full opacity-60 blur-xl" style={{ background: `radial-gradient(circle, ${a}, ${b} 60%, transparent 70%)` }} />
      <div className="relative h-8 w-8 rounded-full bg-[radial-gradient(circle_at_40%_40%,#fff,#ffd9a0_45%,#ff9b4a)] shadow-[0_0_24px_#ffb86b]" />
      {item.slot === 'corona' && <div className="absolute h-16 w-16 rounded-full border-2" style={{ borderColor: a, boxShadow: `0 0 20px ${a}` }} />}
      {item.slot === 'star_rings' && <div className="absolute h-6 w-28 rotate-[-18deg] rounded-[50%] border" style={{ borderColor: a }} />}
      {item.slot === 'aura' && <div className="absolute h-28 w-28 rounded-full opacity-40" style={{ background: `conic-gradient(${a}, ${b}, ${a})`, filter: 'blur(14px)' }} />}
    </div>
  );
}

export function Shop() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data } = useQuery({ queryKey: ['shop'], queryFn: Api.shop });
  const [slot, setSlot] = useState('all');
  const [rarity, setRarity] = useState('all');
  const [track, setTrack] = useState<'all' | 'earnable' | 'premium'>('all');
  const [open, setOpen] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const tryOn = useUniverse((s) => s.tryOn);

  useEffect(() => {
    const status = params.get('status');
    if (status === 'success') toast('Payment received — your item arrives as soon as the provider confirms it.');
    if (status === 'cancelled') toast('Checkout cancelled.');
  }, [params]);

  const owned = useMemo(() => new Map((me?.inventory ?? []).map((i) => [i.itemId, i])), [me]);
  const items = (data?.items ?? []).filter(
    (i) => (slot === 'all' || i.slot === slot) && (rarity === 'all' || i.rarity === rarity) && (track === 'all' || i.track === track) && i.track !== 'exclusive',
  );

  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      refresh();
    } catch (e) {
      toast(e instanceof ApiProblem ? e.message : 'Something went wrong', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const preview = (item: ShopItem | null) => {
    const s = useUniverse.getState();
    if (!item) {
      s.set({ tryOn: {} });
      return;
    }
    s.set({ tryOn: { ...s.tryOn, [item.slot]: item.id } });
    if (me?.claimed && s.focusDetail?.user.githubId !== me.githubId) router.push(`/@${me.login}`);
    toast(`Trying on ${item.name} — only you can see it`, { action: { label: 'Stop', onClick: () => preview(null) } });
  };

  return (
    <>
      <p className="mb-4 text-sm text-[var(--ink-2)]">
        Money buys cosmetics — never size, temperature, luminosity, position or rank.
        {me?.account && (
          <span className="ml-2 font-mono text-[var(--accent)]">
            ✦ {fmt(me.account.stardust)} Stardust
          </span>
        )}
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filters">
        <select value={slot} onChange={(e) => setSlot(e.target.value)} className="glass h-9 px-3 text-sm" aria-label="Slot">
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All slots' : s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} className="glass h-9 px-3 text-sm" aria-label="Rarity">
          {['all', 'common', 'rare', 'epic', 'legendary', 'mythic'].map((r) => (
            <option key={r} value={r}>
              {r === 'all' ? 'All rarities' : r}
            </option>
          ))}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value as typeof track)} className="glass h-9 px-3 text-sm" aria-label="Track">
          <option value="all">Earnable & premium</option>
          <option value="earnable">Earnable (Stardust)</option>
          <option value="premium">Premium</option>
        </select>
        {Object.keys(tryOn).length > 0 && (
          <Button size="sm" variant="quiet" onClick={() => preview(null)}>
            Clear try-on
          </Button>
        )}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => setOpen(i)} className="glass w-full p-3 text-left transition-colors hover:border-[rgba(124,196,255,0.45)]">
              <Swatch item={i} />
              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-[var(--ink-1)]">{i.name}</span>
                <span className="label" style={{ color: RARITY_COLOR[i.rarity] }}>
                  {i.rarity}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-[var(--ink-3)]">
                <span>{i.slot.replace('_', ' ')}</span>
                <span className="font-mono">{owned.has(i.id) ? 'owned' : i.priceStardust !== null ? `✦ ${fmt(i.priceStardust)}` : `$${((i.priceMinor?.USD ?? 0) / 100).toFixed(2)}`}</span>
              </div>
              {i.availableUntil && (
                <div className="mt-1 text-[11px] text-[var(--warn)]">
                  Limited drop · <Countdown until={i.availableUntil} />
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)} title={open.name} description={open.description}>
          <Swatch item={open} />
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="label">Rarity</dt>
              <dd style={{ color: RARITY_COLOR[open.rarity] }}>{open.rarity}</dd>
            </div>
            <div>
              <dt className="label">Slot</dt>
              <dd className="text-[var(--ink-1)]">{open.slot.replace('_', ' ')}</dd>
            </div>
            <div>
              <dt className="label">Owned by</dt>
              <dd className="num font-mono text-[var(--ink-1)]">{fmt(open.ownedPct, 1)}%</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => preview(open)}>
              Try on
            </Button>
            {!me?.claimed ? (
              <a href="/auth/signin?next=/shop">
                <Button variant="primary">Claim your star to buy</Button>
              </a>
            ) : owned.has(open.id) ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => act(() => Api.equip(open.slot, me.equipped[open.slot]?.itemId === open.id ? null : owned.get(open.id)!.id), 'Equipped')}
              >
                {me.equipped[open.slot]?.itemId === open.id ? 'Unequip' : 'Equip'}
              </Button>
            ) : open.track === 'earnable' ? (
              <Button variant="primary" disabled={busy || (me.account?.stardust ?? 0) < (open.priceStardust ?? 0)} onClick={() => act(() => Api.redeem(open.id), `${open.name} is yours`)}>
                Redeem ✦ {compact(open.priceStardust ?? 0)}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await Api.checkout(open.id);
                    location.href = r.checkoutUrl;
                  } catch (e) {
                    toast(e instanceof ApiProblem ? e.message : 'Checkout failed', { tone: 'error' });
                    setBusy(false);
                  }
                }}
              >
                Buy ${((open.priceMinor?.USD ?? 0) / 100).toFixed(2)}
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
