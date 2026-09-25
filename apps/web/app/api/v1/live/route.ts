/**
 * Realtime fallback (local mode, or when Supabase Realtime isn't configured): Server-Sent Events over the in-process bus.
 * Channels: feed:public, cosmic:global, job:<uuid>, user:<own githubId>.
 */
import { type BusMessage, bus } from '@commitverse/pipeline';
import { getSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wanted = new Set((url.searchParams.get('channels') ?? 'feed:public,cosmic:global').split(',').slice(0, 10));
  const session = [...wanted].some((c) => c.startsWith('user:')) ? await getSession() : null;
  for (const c of [...wanted]) {
    const ok =
      c === 'feed:public' || c === 'cosmic:global' || /^job:[0-9a-f-]{36}$/.test(c) || (session && c === `user:${session.githubId}`);
    if (!ok) wanted.delete(c);
  }
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const onMsg = (m: BusMessage) => {
        if (wanted.has(m.channel)) send(`event: ${m.event}\ndata: ${JSON.stringify({ channel: m.channel, ...m.payload })}\n\n`);
      };
      bus.on('message', onMsg);
      const ping = setInterval(() => send(': ping\n\n'), 25_000);
      send('retry: 3000\n\n');
      cleanup = () => {
        clearInterval(ping);
        bus.off('message', onMsg);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
