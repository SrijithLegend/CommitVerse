/** GitHub App webhooks (P2 live comets): HMAC X-Hub-Signature-256 over the raw body, then enqueue. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { json } from '@/lib/server/api';
import { queue } from '@/lib/server/app';
import { problem } from '@/lib/server/errors';

const WANTED = new Set(['push', 'pull_request', 'release']);

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return problem(404, 'not_configured');
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return problem(401, 'bad_signature');
  const event = req.headers.get('x-github-event') ?? '';
  if (!WANTED.has(event)) return json({ ignored: event });
  const payload = JSON.parse(raw) as Record<string, unknown>;
  await (await queue()).send('webhook', { event, payload }, { singletonKey: req.headers.get('x-github-delivery') ?? undefined });
  return json({ queued: true }, { status: 202 });
}
