'use client';
/**
 * F15 multiplayer presence: ships of online users in the same sector (octree level 6), via a Durable Object.
 * 5 Hz quantized state up; one batched snapshot per client down (its 50 nearest). 200 ms interpolation buffer +
 * dead reckoning. Anonymous visitors count but are hidden unless "ghost ships" is on.
 */
import { pathFor } from '@commitverse/universe-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { api } from '@/lib/client/api';
import { useSettings } from '@/lib/client/settings';
import { useUniverse } from '@/stores/universe';
import { useEngine } from '../context';
import { TIERS } from '../quality';
import { decodeSnapshot, EMOTES, encodeState, MSG, type ShipState } from '@commitverse/contracts';

const REALTIME = process.env.NEXT_PUBLIC_REALTIME_URL;
const BUFFER_MS = 200;
const HULL_COLORS = [0xc9ced9, 0xe8ecf6, 0xc9ced9, 0xb08d57];

interface Track {
  samples: { t: number; s: ShipState }[];
  login: string | null;
  emote: { name: string; at: number } | null;
}

function hullGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.4, 1.6, 5);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function Ships() {
  const engine = useEngine();
  const showShips = useSettings((s) => s.ships);
  const ghosts = useSettings((s) => s.ghostShips);
  const tier = useUniverse((s) => s.tier);
  const manifest = useUniverse((s) => s.manifest);
  const tracks = useRef(new Map<number, Track>());
  const ws = useRef<WebSocket | null>(null);
  const sector = useRef<{ key: string; center: [number, number, number]; half: number } | null>(null);
  const lastSend = useRef(0);
  const lastSectorCheck = useRef(0);
  const myId = useRef<number | null>(null);
  const max = TIERS[tier].ships;
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(hullGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 100);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(300), 3);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, []);

  useEffect(() => () => {
    ws.current?.close();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);

  useEffect(() => {
    const onEmote = (e: Event) => {
      const i = EMOTES.indexOf((e as CustomEvent<(typeof EMOTES)[number]>).detail);
      if (i >= 0 && ws.current?.readyState === WebSocket.OPEN) ws.current.send(new Uint8Array([MSG.EMOTE, i]));
    };
    window.addEventListener('cv:emote', onEmote);
    return () => window.removeEventListener('cv:emote', onEmote);
  }, []);

  const connect = async (key: string) => {
    ws.current?.close();
    tracks.current.clear();
    if (!REALTIME) return;
    try {
      const { token, url } = await api<{ token: string; url: string }>('sector-token', { method: 'POST', json: { sector: key } });
      const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/sector/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`);
      socket.binaryType = 'arraybuffer';
      socket.onmessage = (ev) => {
        const half = sector.current?.half ?? 1;
        if (typeof ev.data === 'string') {
          const m = JSON.parse(ev.data) as { type: string; ships?: { id: number; login: string | null }[]; you?: number };
          if (m.type === 'roster' && m.ships) {
            if (m.you) myId.current = m.you;
            for (const s of m.ships) {
              const t = tracks.current.get(s.id) ?? { samples: [], login: null, emote: null };
              t.login = s.login;
              tracks.current.set(s.id, t);
            }
            useUniverse.getState().set({ presence: { ...useUniverse.getState().presence, roster: m.ships } });
          }
          return;
        }
        const buf = ev.data as ArrayBuffer;
        const type = new DataView(buf).getUint8(0);
        if (type === MSG.SNAPSHOT) {
          const { total, ships } = decodeSnapshot(buf, half);
          const now = performance.now();
          const seen = new Set<number>();
          for (const s of ships) {
            if (s.id === myId.current) continue;
            seen.add(s.id);
            const t = tracks.current.get(s.id) ?? { samples: [], login: null, emote: null };
            t.samples.push({ t: now, s });
            if (t.samples.length > 8) t.samples.shift();
            tracks.current.set(s.id, t);
          }
          for (const id of [...tracks.current.keys()]) if (!seen.has(id)) tracks.current.delete(id);
          const p = useUniverse.getState().presence;
          if (p.total !== total || p.sector !== key) useUniverse.getState().set({ presence: { ...p, total, sector: key } });
        } else if (type === MSG.EMOTE_OUT) {
          const v = new DataView(buf);
          const t = tracks.current.get(v.getUint32(1, true));
          if (t) t.emote = { name: EMOTES[v.getUint8(5)] ?? 'wave', at: performance.now() };
          window.dispatchEvent(new CustomEvent('cv:emote-in', { detail: { id: v.getUint32(1, true), emote: EMOTES[v.getUint8(5)] } }));
        }
      };
      ws.current = socket;
    } catch {
      // presence disabled or rate-limited; retry on the next sector change
    }
  };

  useFrame(() => {
    if (!REALTIME || !manifest) return;
    const now = performance.now();
    const pos = engine.rig.pos;
    // sector = octree node at level 6 of the galaxy we're in
    if (now - lastSectorCheck.current > 2000) {
      lastSectorCheck.current = now;
      const g = engine.tiles.galaxyAt([pos[0]!, pos[1]!, pos[2]!]);
      const root = g?.nodes[0];
      if (g && root) {
        const local = { x: pos[0]! - g.center[0], y: pos[1]! - g.center[1], z: pos[2]! - g.center[2] };
        const path = pathFor(local, root.cube, 6);
        const key = `${g.id}:${path}`;
        if (sector.current?.key !== key) {
          let [cx, cy, cz, h] = root.cube;
          for (const ch of path.slice(1)) {
            const o = Number(ch);
            h /= 2;
            cx += o & 1 ? h : -h;
            cy += o & 2 ? h : -h;
            cz += o & 4 ? h : -h;
          }
          sector.current = { key, center: [g.center[0] + cx, g.center[1] + cy, g.center[2] + cz], half: h };
          void connect(key);
        }
      }
    }
    const sec = sector.current;
    const socket = ws.current;
    if (sec && socket?.readyState === WebSocket.OPEN && now - lastSend.current >= 200) {
      lastSend.current = now;
      const q = engine.rig.quat;
      const v = engine.rig.vel;
      socket.send(
        encodeState(
          [pos[0]! - sec.center[0], pos[1]! - sec.center[1], pos[2]! - sec.center[2]],
          sec.half,
          [q.x, q.y, q.z, q.w],
          [v[0]!, v[1]!, v[2]!],
          engine.rig.mode === 'flight' ? 1 : 0,
        ),
      );
    }
    // interpolate 200 ms behind, dead-reckon beyond the newest sample
    if (!sec || !showShips) {
      mesh.count = 0;
      return;
    }
    const renderT = now - BUFFER_MS;
    const m = new THREE.Matrix4();
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    let i = 0;
    const follow = useUniverse.getState().followShip;
    const sorted = [...tracks.current.entries()]
      .filter(([, t]) => t.samples.length && (t.login || ghosts))
      .map(([id, t]) => {
        const last = t.samples.at(-1)!.s;
        return { id, t, d: Math.hypot(last.pos[0] + sec.center[0] - pos[0]!, last.pos[1] + sec.center[1] - pos[1]!, last.pos[2] + sec.center[2] - pos[2]!) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, max);
    for (const { id, t } of sorted) {
      const s = t.samples;
      let a = s[0]!;
      let b = s[s.length - 1]!;
      for (let k = 0; k < s.length - 1; k++) if (s[k]!.t <= renderT && s[k + 1]!.t >= renderT) {
        a = s[k]!;
        b = s[k + 1]!;
      }
      const span = Math.max(1, b.t - a.t);
      const f = Math.max(0, Math.min(1, (renderT - a.t) / span));
      const extra = Math.max(0, renderT - b.t) / 1000;
      const wx = sec.center[0] + a.s.pos[0] + (b.s.pos[0] - a.s.pos[0]) * f + b.s.vel[0] * extra;
      const wy = sec.center[1] + a.s.pos[1] + (b.s.pos[1] - a.s.pos[1]) * f + b.s.vel[1] * extra;
      const wz = sec.center[2] + a.s.pos[2] + (b.s.pos[2] - a.s.pos[2]) * f + b.s.vel[2] * extra;
      p.set(wx - pos[0]!, wy - pos[1]!, wz - pos[2]!);
      qa.set(...a.s.quat).normalize();
      qb.set(...b.s.quat).normalize();
      qa.slerp(qb, f);
      const scale = Math.max(1, p.length() * 0.004);
      const emote = t.emote && now - t.emote.at < 1500 ? t.emote : null;
      if (emote?.name === 'spin') qa.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ((now - emote.at) / 1500) * Math.PI * 4));
      m.compose(p, qa, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, m);
      color.setHex(HULL_COLORS[b.s.hull] ?? 0xe8ecf6).multiplyScalar(emote?.name === 'flare' ? 4 : t.login ? 1.4 : 0.5);
      mesh.setColorAt(i, color);
      if (follow === id && engine.rig.mode === 'orbit') engine.rig.target.set([wx, wy, wz]);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, 0);

  return <primitive object={mesh} />;
}
