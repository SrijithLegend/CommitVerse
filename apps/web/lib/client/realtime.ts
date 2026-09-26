/**
 * Realtime subscriptions (§10): Supabase Realtime broadcast when configured, otherwise the SSE fallback (/api/v1/live).
 * One shared connection per transport; handlers are multiplexed by channel.
 */
type Handler = (event: string, payload: Record<string, unknown>) => void;

const handlers = new Map<string, Set<Handler>>();
let es: EventSource | null = null;
let esChannels = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// biome-ignore lint/suspicious/noExplicitAny: supabase client typed lazily to keep it out of the initial bundle
let supabase: any = null;
// biome-ignore lint/suspicious/noExplicitAny: see above
const sbChannels = new Map<string, any>();

async function supabaseClient() {
  if (!supabase) {
    const { createBrowserClient } = await import('@supabase/ssr');
    supabase = createBrowserClient(supabaseUrl!, supabaseKey!);
  }
  return supabase;
}

const EVENTS = [
  'status',
  'notification',
  'comet',
  'supernova',
  'signal',
  'bake',
  'delta',
  'hide',
  'equip',
  'beacon',
  'flags',
  ...[
    'claimed',
    'achievement_unlocked',
    'gift_opened',
    'signal_sent',
    'repo_milestone',
    'binary_formed',
    'new_hypergiant',
    'release',
    'meteor_shower',
  ],
];

function dispatch(channel: string, event: string, payload: Record<string, unknown>) {
  for (const h of handlers.get(channel) ?? []) h(event, payload);
}

function reconnectSse() {
  const channels = [...handlers.keys()].sort().join(',');
  if (channels === esChannels && es) return;
  es?.close();
  es = null;
  esChannels = channels;
  if (!channels) return;
  es = new EventSource(`/api/v1/live?channels=${encodeURIComponent(channels)}`);
  for (const ev of EVENTS) {
    es.addEventListener(ev, (m) => {
      try {
        const data = JSON.parse((m as MessageEvent).data) as { channel: string } & Record<string, unknown>;
        dispatch(data.channel, ev, data);
      } catch {}
    });
  }
  es.onerror = () => {
    if (es?.readyState === EventSource.CLOSED) {
      es = null;
      esChannels = '';
      reconnectTimer ??= setTimeout(() => {
        reconnectTimer = null;
        reconnectSse();
      }, 3000);
    }
  };
}

export function subscribe(channel: string, handler: Handler): () => void {
  if (typeof window === 'undefined') return () => {};
  const set = handlers.get(channel) ?? new Set();
  set.add(handler);
  handlers.set(channel, set);
  if (supabaseUrl && supabaseKey) {
    if (!sbChannels.has(channel)) {
      void supabaseClient().then((sb) => {
        const ch = sb.channel(channel);
        ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: Record<string, unknown> }) =>
          dispatch(channel, msg.event, msg.payload),
        );
        ch.subscribe();
        sbChannels.set(channel, ch);
      });
    }
  } else {
    queueMicrotask(reconnectSse);
  }
  return () => {
    set.delete(handler);
    if (set.size) return;
    handlers.delete(channel);
    const ch = sbChannels.get(channel);
    if (ch) {
      void ch.unsubscribe();
      sbChannels.delete(channel);
    } else queueMicrotask(reconnectSse);
  };
}
