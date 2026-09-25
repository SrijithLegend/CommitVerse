/** Cached github id → brief (incl. float64 position) lookups, batched (≤ 50 ids per request, §6.7). */
import type { StarBrief } from '@commitverse/contracts';
import { Api } from './api';

const cache = new Map<number, StarBrief>();
const waiting = new Map<number, ((b: StarBrief | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const ids = [...waiting.keys()].slice(0, 50);
  if (!ids.length) return;
  const cbs = new Map(ids.map((id) => [id, waiting.get(id)!]));
  for (const id of ids) waiting.delete(id);
  Api.briefs(ids)
    .then((r) => {
      const found = new Map(r.stars.map((s) => [s.githubId, s]));
      for (const [id, fns] of cbs) {
        const b = found.get(id) ?? null;
        if (b) cache.set(id, b);
        for (const f of fns) f(b);
      }
    })
    .catch(() => {
      for (const fns of cbs.values()) for (const f of fns) f(null);
    })
    .finally(() => {
      if (waiting.size) timer = setTimeout(flush, 30);
    });
}

export function brief(id: number): Promise<StarBrief | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = waiting.get(id) ?? [];
    list.push(resolve);
    waiting.set(id, list);
    timer ??= setTimeout(flush, 30);
  });
}

export const cachedBrief = (id: number): StarBrief | undefined => cache.get(id);
