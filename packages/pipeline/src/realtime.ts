/**
 * §10 realtime channels. Production: Supabase Realtime broadcast via its REST endpoint (server → clients).
 * Local mode: an in-process bus that the web app's SSE endpoint relays to browsers.
 */
import { EventEmitter } from 'node:events';
import { log } from './log';

export type Channel = 'feed:public' | 'cosmic:global' | `job:${string}` | `user:${number}`;

export interface BusMessage {
  channel: Channel;
  event: string;
  payload: Record<string, unknown>;
}

const g = globalThis as unknown as { __cvBus?: EventEmitter };
export const bus: EventEmitter = g.__cvBus ?? new EventEmitter();
bus.setMaxListeners(10_000);
g.__cvBus = bus;

export async function broadcast(channel: Channel, event: string, payload: Record<string, unknown>): Promise<void> {
  bus.emit('message', { channel, event, payload } satisfies BusMessage);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: channel, event, payload, private: false }] }),
    });
    if (!res.ok) log.warn({ channel, status: res.status }, 'realtime broadcast failed');
  } catch (err) {
    log.warn({ channel, err: String(err) }, 'realtime broadcast error');
  }
}
