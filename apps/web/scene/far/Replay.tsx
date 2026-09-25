'use client';
/**
 * F17 Big Bang replay: stars ignite at createdAt; brightness grows with cumulative yearly contributions; galaxies
 * fill in as languages rise. Uses the history tile layer (`/u/{v}/h/{galaxy}/{node}.hist.bin`), fetched only here.
 * Unborn stars are hidden through the GPU bitmask; born stars' L_q byte is driven by their log-quantized history.
 */
import { tilePath } from '@commitverse/universe-core';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { useUniverse } from '@/stores/universe';
import { useEngine } from '../context';

interface HistNode {
  day: Float32Array;
  levels: Uint8Array; // count × years
  years: number;
  firstYear: number;
  props: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
  original: Uint8Array;
}

const EPOCH_DAYS_2008 = Date.UTC(2008, 0, 1) / 86_400_000;

export function parseHist(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, false) !== 0x43564831) throw new Error('bad hist magic');
  const firstYear = dv.getUint16(4, true);
  const years = dv.getUint16(6, true);
  const n = dv.getUint32(8, true);
  const rec = 2 + years;
  const day = new Float32Array(n);
  const levels = new Uint8Array(n * years);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * rec;
    day[i] = dv.getUint16(o, true);
    for (let y = 0; y < years; y++) levels[i * years + y] = dv.getUint8(o + 2 + y);
  }
  return { firstYear, years, day, levels };
}

export function Replay() {
  const engine = useEngine();
  const year = useUniverse((s) => s.replayYear);
  const version = useUniverse((s) => s.bakeVersion);
  const nodes = useRef(new Map<string, HistNode>());
  const inflight = useRef(new Set<string>());
  const lastApplied = useRef(-1);

  useEffect(() => {
    if (year !== null) return;
    for (const n of nodes.current.values()) {
      (n.props.array as Uint8Array).set(n.original);
      n.props.needsUpdate = true;
    }
    nodes.current.clear();
    engine.tiles.setReplayHidden(null);
    lastApplied.current = -1;
  }, [year, engine]);

  useFrame(() => {
    if (year === null || !version) return;
    for (const n of engine.tiles.loadedNodes()) {
      const key = `${n.galaxyId}/${n.key}`;
      if (nodes.current.has(key) || inflight.current.has(key) || inflight.current.size >= 6) continue;
      inflight.current.add(key);
      void fetch(`${engine.tiles.base}/${tilePath(version, n.galaxyId, n.key, 'hist.bin')}`)
        .then(async (res) => {
          if (!res.ok) return;
          const h = parseHist(await res.arrayBuffer());
          const props = n.object.geometry.getAttribute('aProps') as THREE.BufferAttribute;
          const index = n.object.geometry.getAttribute('aIndex') as THREE.BufferAttribute;
          nodes.current.set(key, { ...h, props, index, original: (props.array as Uint8Array).slice() });
          lastApplied.current = -1;
        })
        .catch(() => {})
        .finally(() => inflight.current.delete(key));
    }
    const step = Math.round(year * 20) / 20;
    if (step === lastApplied.current) return;
    lastApplied.current = step;
    const dayNow = EPOCH_DAYS_2008 + (step - 2008) * 365.25;
    const unborn = new Set<number>();
    for (const n of nodes.current.values()) {
      const arr = n.props.array as Uint8Array;
      const idx = n.index.array as Uint32Array;
      const yi = Math.max(0, Math.min(n.years - 1, Math.floor(step) - n.firstYear));
      for (let i = 0; i < n.day.length; i++) {
        if (n.day[i]! > dayNow) {
          unborn.add(idx[i]!);
          continue;
        }
        const level = n.levels[i * n.years + yi]!;
        arr[i * 4 + 2] = Math.min(n.original[i * 4 + 2]!, Math.max(8, level));
      }
      n.props.needsUpdate = true;
    }
    engine.tiles.setReplayHidden(unborn);
  });
  return null;
}
