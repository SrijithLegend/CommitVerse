'use client';
/**
 * F19 star chart: a 2D canvas projection of the supercluster (top-down XZ) with pan/zoom, search, filters
 * (class, state, claimed, online) and click-to-warp. Works without WebGL (it's what list/accessible mode builds on).
 * Stars come straight from each galaxy's root tile (the brightest 4,096 per galaxy) — no extra API.
 */
import { decodeTile, dequantizeTemperature, kelvinToHex, type Manifest, tilePath, unpackFlags } from '@commitverse/universe-core';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Api } from '@/lib/client/api';
import { brief } from '@/lib/client/positions';

interface ChartStar {
  x: number;
  z: number;
  color: string;
  cls: number;
  state: string;
  claimed: boolean;
  online: boolean;
  id: number;
  L: number;
}

const CLASSES = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];
const clsOf = (T: number) => (T < 3700 ? 0 : T < 5200 ? 1 : T < 6000 ? 2 : T < 7500 ? 3 : T < 10000 ? 4 : T < 30000 ? 5 : 6);

export function useChartData() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stars, setStars] = useState<ChartStar[]>([]);
  const [base, setBase] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const u = await Api.universe();
      const b = u.manifestUrl.slice(0, u.manifestUrl.indexOf('/u/'));
      const m = (await (await fetch(u.manifestUrl)).json()) as Manifest;
      if (!alive) return;
      setBase(b);
      setManifest(m);
      const all: ChartStar[] = [];
      await Promise.all(
        m.galaxies.map(async (g) => {
          const [tile, ids] = await Promise.all([
            fetch(`${b}/${tilePath(m.bakeVersion, g.id, 'r')}`).then((r) => r.arrayBuffer()),
            fetch(`${b}/${tilePath(m.bakeVersion, g.id, 'r', 'ids.bin')}`).then((r) => r.arrayBuffer()),
          ]);
          const { records } = decodeTile(tile);
          const idArr = new Uint32Array(ids);
          records.forEach((r, i) => {
            const T = dequantizeTemperature(r.tq);
            const f = unpackFlags(r.flags);
            all.push({
              x: g.center[0] + r.x,
              z: g.center[2] + r.z,
              color: kelvinToHex(T),
              cls: clsOf(T),
              state: f.state,
              claimed: f.flags.includes('claimed'),
              online: f.flags.includes('online'),
              id: idArr[i] ?? 0,
              L: (r.lq / 255) * 1.25,
            });
          });
        }),
      );
      if (alive) setStars(all);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { manifest, stars, base };
}

export interface ChartFilters {
  classes: Set<number>;
  state: 'all' | 'protostar' | 'main' | 'red_giant' | 'white_dwarf';
  claimed: boolean;
  online: boolean;
}

export function StarChart({ onPick, height = 520 }: { onPick?: (login: string) => void; height?: number }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { manifest, stars } = useChartData();
  const [filters, setFilters] = useState<ChartFilters>({
    classes: new Set([0, 1, 2, 3, 4, 5, 6]),
    state: 'all',
    claimed: false,
    online: false,
  });
  const view = useRef({ cx: 0, cz: 0, scale: 0.002 });
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState('');

  const visible = useMemo(
    () =>
      stars.filter(
        (s) =>
          filters.classes.has(s.cls) &&
          (filters.state === 'all' || s.state === filters.state) &&
          (!filters.claimed || s.claimed) &&
          (!filters.online || s.online),
      ),
    [stars, filters],
  );

  // fit to the universe once loaded
  useEffect(() => {
    if (!manifest || !canvas.current) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const g of manifest.galaxies) {
      minX = Math.min(minX, g.center[0] - g.radius);
      maxX = Math.max(maxX, g.center[0] + g.radius);
      minZ = Math.min(minZ, g.center[2] - g.radius);
      maxZ = Math.max(maxZ, g.center[2] + g.radius);
    }
    const w = canvas.current.clientWidth;
    view.current = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale: Math.min(w / (maxX - minX), height / (maxZ - minZ)) * 0.92 };
    setTick((t) => t + 1);
  }, [manifest, height]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a redraw after pan/zoom mutate the view ref
  useEffect(() => {
    const c = canvas.current;
    if (!c || !manifest) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { cx, cz, scale } = view.current;
    const w = c.clientWidth;
    const toX = (x: number) => (x - cx) * scale + w / 2;
    const toY = (z: number) => (z - cz) * scale + height / 2;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, w, height);
    ctx.strokeStyle = 'rgba(160,190,255,0.06)';
    ctx.lineWidth = 1;
    for (const g of manifest.galaxies) {
      ctx.beginPath();
      ctx.arc(toX(g.center[0]), toY(g.center[2]), g.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of visible) {
      const r = Math.max(0.6, (0.6 + s.L * 1.6) * Math.min(3, Math.max(1, scale * 400)));
      ctx.fillStyle = s.color;
      ctx.globalAlpha = 0.35 + Math.min(0.65, s.L);
      ctx.beginPath();
      ctx.arc(toX(s.x), toY(s.z), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(154,164,189,0.85)';
    ctx.textAlign = 'center';
    for (const g of manifest.galaxies) ctx.fillText(g.language.toUpperCase(), toX(g.center[0]), toY(g.center[2]) - g.radius * scale - 6);
  }, [manifest, visible, tick, height]);

  // pan / zoom / pick
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.current.cx -= dx / view.current.scale;
      view.current.cz -= dy / view.current.scale;
      drag.x = e.clientX;
      drag.y = e.clientY;
      setTick((t) => t + 1);
    };
    const up = async (e: PointerEvent) => {
      const wasClick = drag && !drag.moved;
      drag = null;
      if (!wasClick) return;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { cx, cz, scale } = view.current;
      let best: ChartStar | null = null;
      let bd = 64;
      for (const s of visible) {
        const d = ((s.x - cx) * scale + rect.width / 2 - mx) ** 2 + ((s.z - cz) * scale + height / 2 - my) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (!best?.id) return;
      const b = await brief(best.id);
      if (!b) return;
      setStatus(`@${b.login}, ${b.spectralClass}-class ${b.state.replace('_', ' ')} star in the ${b.galaxy} galaxy`);
      if (onPick) onPick(b.login);
      else router.push(`/@${b.login}`);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - height / 2;
      const v = view.current;
      const k = Math.exp(-e.deltaY * 0.0015);
      v.cx += mx / v.scale - mx / (v.scale * k);
      v.cz += my / v.scale - my / (v.scale * k);
      v.scale *= k;
      setTick((t) => t + 1);
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
    };
  }, [visible, height, onPick, router]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Chart filters">
        {CLASSES.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-pressed={filters.classes.has(i)}
            onClick={() =>
              setFilters((f) => {
                const next = new Set(f.classes);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return { ...f, classes: next };
              })
            }
            className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${filters.classes.has(i) ? 'border-[rgba(124,196,255,0.5)] text-[var(--ink-1)]' : 'border-[var(--panel-border)] text-[var(--ink-3)]'}`}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ background: kelvinToHex([3000, 4400, 5600, 6700, 8600, 17000, 34000][i]!) }}
            />
            {c}
          </button>
        ))}
        <select
          value={filters.state}
          onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as ChartFilters['state'] }))}
          className="glass h-7 px-2 text-[12px] text-[var(--ink-1)]"
          aria-label="State filter"
        >
          <option value="all">All states</option>
          <option value="protostar">Protostars</option>
          <option value="main">Main sequence</option>
          <option value="red_giant">Red giants</option>
          <option value="white_dwarf">White dwarfs</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
          <input type="checkbox" checked={filters.claimed} onChange={(e) => setFilters((f) => ({ ...f, claimed: e.target.checked }))} />{' '}
          Claimed
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--ink-2)]">
          <input type="checkbox" checked={filters.online} onChange={(e) => setFilters((f) => ({ ...f, online: e.target.checked }))} />{' '}
          Coding now
        </label>
        <span className="ml-auto font-mono text-[11px] text-[var(--ink-3)]">{visible.length.toLocaleString()} stars shown</span>
      </div>
      <canvas
        ref={canvas}
        style={{ width: '100%', height }}
        className="cursor-crosshair rounded-[10px] border border-[var(--panel-border)]"
        aria-label="Star chart — use list mode for a keyboard-navigable table"
        role="img"
      />
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
