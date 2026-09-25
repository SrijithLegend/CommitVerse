'use client';
/** F18 settings: graphics, motion, audio, privacy (incl. Remove my star), profile, binary, gifts, beacon tokens, export. */
import { Button, Dialog, fmt, Slider, Switch } from '@commitverse/ui-kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Api, ApiProblem, api } from '@/lib/client/api';
import { type QualitySetting, useSettings } from '@/lib/client/settings';
import { useMe } from './Providers';
import { toast } from './Toaster';

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass mb-4 scroll-mt-20 p-5">
      <h2 className="label mb-3">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsView() {
  const s = useSettings();
  const { data: me, refetch } = useMe();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [banner, setBanner] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const priv = (me?.account?.settings ?? {}) as Record<string, boolean>;
  const { data: repos } = useQuery({ queryKey: ['my-repos'], queryFn: () => api<{ repos: { id: number; name: string; stars: number; planet_slot: number | null }[] }>('me/repos'), enabled: !!me?.claimed });
  const { data: tokens, refetch: refetchTokens } = useQuery({
    queryKey: ['beacon-tokens'],
    queryFn: () => api<{ tokens: { id: string; createdAt: string; revokedAt: string | null }[] }>('me/beacon-tokens'),
    enabled: !!me?.claimed,
  });
  const [pinned, setPinned] = useState<number[]>([]);

  useEffect(() => {
    if (params.get('confirm') === 'remove') setConfirmRemove(true);
  }, [params]);
  useEffect(() => {
    if (!me?.account) return;
    setBio(me.account.bioOverride ?? '');
    setCountry(me.account.country ?? '');
    setPinned(me.account.pinnedOverride ?? []);
    setBanner(me.banner?.text ?? '');
  }, [me]);

  const patch = async (body: Record<string, unknown>, ok = 'Saved') => {
    try {
      await Api.patchMe(body);
      toast(ok);
      void refetch();
    } catch (e) {
      toast(e instanceof ApiProblem ? e.message : 'Could not save', { tone: 'error' });
    }
  };

  return (
    <>
      <Section title="Graphics">
        <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Quality">
          {(['auto', 'low', 'medium', 'high', 'ultra'] as QualitySetting[]).map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={s.quality === q}
              onClick={() => s.set({ quality: q })}
              className={`rounded-full border px-3 py-1 text-sm capitalize ${s.quality === q ? 'border-[var(--accent)] text-[var(--ink-1)]' : 'border-[var(--panel-border)] text-[var(--ink-2)]'}`}
            >
              {q}
            </button>
          ))}
        </div>
        <p className="mb-2 text-xs text-[var(--ink-3)]">Auto adapts to your device; choosing a tier turns adaptation off.</p>
        <Switch id="bloom" label="Bloom" checked={s.bloom} onCheckedChange={(v) => s.set({ bloom: v })} />
        <Switch id="dust" label="Dust lanes" checked={s.dust} onCheckedChange={(v) => s.set({ dust: v })} />
        <Switch id="const" label="Constellations" checked={s.constellations} onCheckedChange={(v) => s.set({ constellations: v })} />
        <Switch id="labels" label="Labels" checked={s.labels} onCheckedChange={(v) => s.set({ labels: v })} />
        <Switch id="ships" label="Other explorers’ ships" checked={s.ships} onCheckedChange={(v) => s.set({ ships: v })} />
        <Switch id="ghosts" label="Show anonymous (ghost) ships" checked={s.ghostShips} onCheckedChange={(v) => s.set({ ghostShips: v })} />
        <Slider label="Comet density" value={s.cometDensity} onValueChange={(v) => s.set({ cometDensity: v })} />
        <Switch id="fps" label="FPS counter" checked={s.fps} onCheckedChange={(v) => s.set({ fps: v })} />
        <Switch id="list" label="Accessible list mode (no 3D)" checked={s.listMode} onCheckedChange={(v) => s.set({ listMode: v })} />
      </Section>

      <Section title="Motion">
        <div className="flex gap-2" role="radiogroup" aria-label="Reduced motion">
          {(['system', 'on', 'off'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.reducedMotion === m}
              onClick={() => s.set({ reducedMotion: m })}
              className={`rounded-full border px-3 py-1 text-sm ${s.reducedMotion === m ? 'border-[var(--accent)] text-[var(--ink-1)]' : 'border-[var(--panel-border)] text-[var(--ink-2)]'}`}
            >
              {m === 'system' ? 'Follow system' : m === 'on' ? 'Reduce motion' : 'Full motion'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-3)]">Reduced motion disables warp streaks, camera shake and auto-rotate; warps become 400 ms crossfades.</p>
      </Section>

      <Section title="Audio">
        <Switch id="audio" label="Sound" checked={s.audio.enabled} onCheckedChange={(v) => s.set({ audio: { ...s.audio, enabled: v } })} />
        <Slider label="Master" value={s.audio.master} onValueChange={(v) => s.set({ audio: { ...s.audio, master: v } })} />
        <Slider label="Ambience" value={s.audio.ambience} onValueChange={(v) => s.set({ audio: { ...s.audio, ambience: v } })} />
        <Slider label="Interface" value={s.audio.ui} onValueChange={(v) => s.set({ audio: { ...s.audio, ui: v } })} />
      </Section>

      {!me && (
        <Section title="Your star">
          <p className="text-sm text-[var(--ink-2)]">Sign in with GitHub to claim, customize or remove your star. Removal doesn’t require claiming.</p>
          <div className="mt-3 flex gap-2">
            <a href="/auth/signin?next=/settings">
              <Button variant="primary">Claim your star</Button>
            </a>
            <a href="/auth/signin?intent=remove">
              <Button variant="danger">Remove my star</Button>
            </a>
          </div>
        </Section>
      )}

      {me?.claimed && me.account && (
        <>
          <Section id="checkin" title="Stardust">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--ink-2)]">
                <span className="font-mono text-[var(--accent)]">✦ {fmt(me.account.stardust)}</span> · daily check-in streak {me.checkin.streak} d
              </p>
              <Button
                variant="primary"
                size="sm"
                disabled={me.checkin.lastOn === new Date().toISOString().slice(0, 10)}
                onClick={async () => {
                  try {
                    const r = await Api.checkin();
                    toast(`+${r.granted} ✦ (streak ${r.streak})`);
                    void refetch();
                  } catch (e) {
                    toast(e instanceof ApiProblem ? e.message : 'Check-in failed', { tone: 'error' });
                  }
                }}
              >
                Daily check-in
              </Button>
            </div>
          </Section>

          <Section title="Profile">
            <label className="block text-sm text-[var(--ink-1)]" htmlFor="bio">
              Bio override <span className="text-[var(--ink-3)]">({bio.length}/160)</span>
            </label>
            <textarea id="bio" value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} className="glass mt-1 h-20 w-full p-2 text-sm outline-none" />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void patch({ bioOverride: bio || null })}>
                Save bio
              </Button>
            </div>
            <label className="mt-4 block text-sm text-[var(--ink-1)]" htmlFor="country">
              Country (optional, used only for the country leaderboard)
            </label>
            <div className="mt-1 flex gap-2">
              <input id="country" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="IN" className="glass h-9 w-20 px-2 font-mono text-sm outline-none" />
              <Button size="sm" onClick={() => void patch({ country: country || null })}>
                Save
              </Button>
            </div>
            {repos && repos.repos.length > 0 && (
              <div className="mt-5">
                <div className="text-sm text-[var(--ink-1)]">Pinned planets (up to 8, in order)</div>
                <ul className="mt-2 max-h-56 overflow-auto scroll-thin">
                  {repos.repos.map((r) => {
                    const idx = pinned.indexOf(r.id);
                    return (
                      <li key={r.id}>
                        <label className="flex items-center gap-2 py-1 text-sm text-[var(--ink-2)]">
                          <input
                            type="checkbox"
                            checked={idx >= 0}
                            disabled={idx < 0 && pinned.length >= 8}
                            onChange={(e) => setPinned((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                          />
                          {idx >= 0 && <span className="font-mono text-[11px] text-[var(--accent)]">{idx + 1}</span>}
                          {r.name} <span className="font-mono text-[11px] text-[var(--ink-3)]">★ {r.stars}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="quiet" onClick={() => void patch({ pinnedOverride: null }, 'Using your top repos by stars')}>
                    Reset
                  </Button>
                  <Button size="sm" onClick={() => void patch({ pinnedOverride: pinned })}>
                    Save planets
                  </Button>
                </div>
              </div>
            )}
            {me.inventory.some((i) => i.itemId === 'banner.beacon') && (
              <div className="mt-5">
                <label className="block text-sm text-[var(--ink-1)]" htmlFor="banner">
                  Beacon banner text (≤ 24 chars, reviewed before it appears) {me.banner && <span className="label">· {me.banner.status}</span>}
                </label>
                <div className="mt-1 flex gap-2">
                  <input id="banner" value={banner} maxLength={24} onChange={(e) => setBanner(e.target.value)} className="glass h-9 flex-1 px-2 text-sm outline-none" />
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await api('me/banner', { method: 'PUT', json: { text: banner } });
                        toast('Banner submitted for review');
                        void refetch();
                      } catch (e) {
                        toast(e instanceof ApiProblem ? e.message : 'Rejected', { tone: 'error' });
                      }
                    }}
                  >
                    Submit
                  </Button>
                </div>
              </div>
            )}
          </Section>

          <Section id="binary" title="Binary system">
            {me.bindings.length === 0 && <p className="text-sm text-[var(--ink-2)]">No binary. Open another claimed star’s panel and choose “Form binary”.</p>}
            <ul className="space-y-2">
              {me.bindings.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink-1)]">
                    @{b.other} <span className="label">{b.status}</span>
                  </span>
                  <span className="flex gap-2">
                    {b.status === 'pending' && !b.requestedByMe && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => Api.binding(b.id, 'accept').then(() => refetch())}>
                          Accept
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => Api.binding(b.id, 'decline').then(() => refetch())}>
                          Decline
                        </Button>
                      </>
                    )}
                    {(b.status === 'active' || b.requestedByMe) && (
                      <Button size="sm" variant="quiet" onClick={() => Api.binding(b.id, 'dissolve').then(() => refetch())}>
                        {b.status === 'active' ? 'Dissolve' : 'Cancel'}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="gifts" title="Gifts">
            {me.gifts.length === 0 && <p className="text-sm text-[var(--ink-2)]">No gift pods orbiting your star.</p>}
            <ul className="space-y-2">
              {me.gifts.map((g) => (
                <li key={g.id} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink-1)]">
                    {g.itemId} <span className="text-[var(--ink-3)]">from {g.anonymous ? 'someone' : `@${g.from}`}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={g.state !== 'delivered'}
                    onClick={async () => {
                      await Api.openGift(g.id, true);
                      toast('Unwrapped and equipped ✦');
                      void refetch();
                    }}
                  >
                    Open & equip
                  </Button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Beacon (VS Code)">
            <p className="text-sm text-[var(--ink-2)]">Install the Commitverse Beacon extension and sign in with the device code, or create a token here. The extension only ever sends the language you’re editing — never file names, paths, repos or code.</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const r = await api<{ token: string }>('me/beacon-tokens', { method: 'POST' });
                  setNewToken(r.token);
                  void refetchTokens();
                }}
              >
                Create beacon token
              </Button>
            </div>
            {newToken && (
              <p className="mt-2 break-all rounded bg-[rgba(160,190,255,0.06)] p-2 font-mono text-xs text-[var(--ink-1)]">
                {newToken} <span className="block text-[var(--warn)]">Shown once — copy it now.</span>
              </p>
            )}
            <ul className="mt-3 space-y-1 text-xs">
              {tokens?.tokens.map((t) => (
                <li key={t.id} className="flex justify-between text-[var(--ink-2)]">
                  <span className="font-mono">
                    {t.id.slice(0, 8)} · {new Date(t.createdAt).toLocaleDateString()} {t.revokedAt ? '· revoked' : ''}
                  </span>
                  {!t.revokedAt && (
                    <button type="button" className="text-[var(--danger)]" onClick={() => api('me/beacon-tokens', { method: 'DELETE', json: { id: t.id } }).then(() => refetchTokens())}>
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {me && (
        <Section title="Privacy & data">
          {me.claimed && (
            <>
              <Switch id="hf" label="Hide me from the feed" checked={!!priv.hideFromFeed} onCheckedChange={(v) => void patch({ settings: { hideFromFeed: v } })} />
              <Switch id="hl" label="Hide me from leaderboards" checked={!!priv.hideFromLeaderboards} onCheckedChange={(v) => void patch({ settings: { hideFromLeaderboards: v } })} />
              <Switch id="ds" label="Disable signals" checked={!!priv.disableSignals} onCheckedChange={(v) => void patch({ settings: { disableSignals: v } })} />
              <Switch id="hb" label="Hide my beacon" checked={!!priv.hideBeacon} onCheckedChange={(v) => void patch({ settings: { hideBeacon: v } })} />
              <Switch id="ed" label="Weekly email digest" checked={!!priv.emailDigest} onCheckedChange={(v) => void patch({ settings: { emailDigest: v } })} />
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/api/v1/me/export" download>
              <Button size="sm" variant="ghost">
                Export my data (JSON)
              </Button>
            </a>
            <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>
              Remove my star
            </Button>
          </div>
        </Section>
      )}

      {confirmRemove && me && (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(false)} title="Remove your star?" description="Your star disappears within minutes. Metrics, repos, social data and inventory are deleted within 24 hours. Only a tombstone of your GitHub id remains, to stop the star re-forming.">
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={() => setConfirmRemove(false)}>
              Keep my star
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api('me', { method: 'DELETE' });
                await qc.invalidateQueries();
                location.href = '/';
              }}
            >
              Remove permanently
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
