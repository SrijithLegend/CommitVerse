'use client';
/**
 * F14 share cards (landscape 1200×630, stories 1080×1920): a real 2× render from a flattering preset camera, with the
 * stats overlay composed on a 2D canvas → PNG download / Web Share. Plus a /v/{id} link to this exact shot.
 */
import { Button, Dialog, Tabs } from '@commitverse/ui-kit';
import { kelvinToHex, spectralSubclass } from '@commitverse/universe-core';
import { useEffect, useState } from 'react';
import { Api } from '@/lib/client/api';
import { engineRef } from '@/lib/client/engine-ref';
import { sceneCommands, useUniverse } from '@/stores/universe';
import { toast } from '../Toaster';

const fmt = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

async function compose(shot: Blob, preset: 'landscape' | 'stories'): Promise<Blob | null> {
  const d = useUniverse.getState().focusDetail;
  const [w, h] = preset === 'landscape' ? [2400, 1260] : [2160, 3840];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = await createImageBitmap(shot);
  ctx.drawImage(img, 0, 0, w, h);
  const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
  grad.addColorStop(0, 'rgba(3,4,10,0)');
  grad.addColorStop(1, 'rgba(3,4,10,0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.05;
  const s = w / 1200;
  ctx.fillStyle = '#9aa4bd';
  ctx.font = `500 ${18 * s}px ui-monospace, monospace`;
  ctx.fillText('C O M M I T V E R S E', pad, pad + 10 * s);
  if (d) {
    const color = kelvinToHex(d.body.temperature);
    const baseY = preset === 'landscape' ? h - pad - 120 * s : h - pad - 260 * s;
    ctx.fillStyle = '#e8ecf6';
    ctx.font = `600 ${54 * s}px system-ui, sans-serif`;
    ctx.fillText(d.user.name ?? d.user.login, pad, baseY);
    ctx.fillStyle = '#9aa4bd';
    ctx.font = `${24 * s}px ui-monospace, monospace`;
    ctx.fillText(`@${d.user.login} · ${d.body.galaxy.language} galaxy`, pad, baseY + 38 * s);
    ctx.fillStyle = color;
    ctx.fillText(`${spectralSubclass(d.body.temperature)} · ${d.body.state.replace('_', ' ')}${d.body.flags.includes('pulsar') ? ' · pulsar' : ''}`, pad, baseY + 74 * s);
    const stats: [string, string][] = [
      ['CONTRIBUTIONS', fmt(d.metrics.cTotal)],
      ['30 DAYS', fmt(d.metrics.c30)],
      ['STARS', fmt(d.metrics.starsTotal)],
      ['RANK', d.body.rankGalaxy ? `#${d.body.rankGalaxy.toLocaleString()}` : '—'],
    ];
    stats.forEach(([k, v], i) => {
      const x = preset === 'landscape' ? w - pad - (3 - i) * 180 * s - 120 * s : pad + i * 230 * s;
      const y = preset === 'landscape' ? baseY + 10 * s : baseY + 150 * s;
      ctx.fillStyle = '#5b6480';
      ctx.font = `${14 * s}px ui-monospace, monospace`;
      ctx.fillText(k, x, y);
      ctx.fillStyle = '#e8ecf6';
      ctx.font = `${34 * s}px ui-monospace, monospace`;
      ctx.fillText(v, x, y + 40 * s);
    });
  }
  ctx.fillStyle = '#5b6480';
  ctx.font = `${13 * s}px system-ui, sans-serif`;
  ctx.fillText('Not affiliated with GitHub, Inc.', pad, h - pad * 0.45);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export function ShareDialog() {
  const [preset, setPreset] = useState<'landscape' | 'stories'>('landscape');
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const focus = useUniverse((s) => s.focusDetail);
  const close = () => useUniverse.getState().set({ overlay: null });

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const shot = new Promise<Blob | null>((resolve) => sceneCommands.push({ type: 'screenshot', preset, resolve }));
    void shot
      .then((b) => (b ? compose(b, preset) : null))
      .then((b) => {
        if (!alive) return;
        setBlob(b);
        if (url) URL.revokeObjectURL(url);
        setUrl(b ? URL.createObjectURL(b) : null);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: regenerate only when the preset changes
  }, [preset]);

  const copyViewLink = async () => {
    const e = engineRef.current;
    if (!e) return;
    const snap = e.rig.snapshot();
    const r = await Api.shareView({ pos: snap.pos, quat: snap.quat, focus: focus?.user.login ?? null, t: Date.now() / 1000 });
    const link = `${location.origin}${r.url}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast('Link to this exact view copied');
  };

  const share = async () => {
    if (!blob) return;
    const file = new File([blob], `commitverse-${focus?.user.login ?? 'view'}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'My star on Commitverse' }).catch(() => {});
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Share" description="A real render of this system, ready to post." wide>
      <Tabs
        value={preset}
        onValueChange={(v) => setPreset(v as typeof preset)}
        tabs={[
          { value: 'landscape', label: 'Landscape 1200×630' },
          { value: 'stories', label: 'Stories 1080×1920' },
        ]}
      />
      <div className="mt-4 flex justify-center">
        {busy || !url ? (
          <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-lg border border-[var(--panel-border)] text-sm text-[var(--ink-3)]">Rendering…</div>
        ) : (
          // biome-ignore lint/performance/noImgElement: blob preview
          <img src={url} alt="Share card preview" className={`rounded-lg border border-[var(--panel-border)] ${preset === 'stories' ? 'max-h-[56vh]' : 'w-full'}`} />
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void copyViewLink()}>
          Copy link to this view
        </Button>
        {focus && (
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(`[![My star on Commitverse](${location.origin}/api/embed/${focus.user.login}.svg)](${location.origin}/@${focus.user.login})`);
              toast('README embed snippet copied');
            }}
          >
            Copy README embed
          </Button>
        )}
        <Button variant="primary" disabled={!blob} onClick={() => void share()}>
          Share / download PNG
        </Button>
      </div>
    </Dialog>
  );
}
