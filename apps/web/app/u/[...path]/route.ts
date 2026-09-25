/**
 * Local-mode tile server (production serves /u/* from R2 behind the CDN at NEXT_PUBLIC_TILES_BASE_URL).
 * Versioned paths are immutable; current.json and live/delta.bin are short-lived with ETags.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { localDataDir } from '@commitverse/pipeline';

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path;
  const rel = normalize(join(...parts));
  if (rel.includes('..') || !/^[\w.\-/\\]+$/.test(rel)) return new Response('Bad path', { status: 400 });
  const file = join(localDataDir(), 'tiles', 'u', rel);
  if (!existsSync(file)) return new Response('Not found', { status: 404 });
  const st = statSync(file);
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const live = rel.startsWith('live') || rel === 'current.json';
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(readFileSync(file), {
    headers: {
      'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'cache-control': live ? 'public, max-age=30, must-revalidate' : 'public, max-age=31536000, immutable',
      etag,
      'access-control-allow-origin': '*',
    },
  });
}
