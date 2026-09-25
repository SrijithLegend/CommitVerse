/** Beacon tokens (§11.2): random 32 bytes, shown once, stored as SHA-256, heartbeat-only scope, revocable. */
import { randomToken, sha256 } from '@commitverse/pipeline';
import { z } from 'zod';
import { body, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

export const GET = route({ auth: 'claimed' }, async ({ session }) => ({
  tokens: (
    await (
      await db()
    ).query<{ id: string; created_at: Date; revoked_at: Date | null }>(
      'select id, created_at, revoked_at from beacon_tokens where github_id = $1 order by created_at desc',
      [session!.githubId],
    )
  ).map((t) => ({ id: t.id, createdAt: t.created_at.toISOString(), revokedAt: t.revoked_at?.toISOString() ?? null })),
}));

export const POST = route(
  { auth: 'claimed', limits: [{ name: 'beacon-token', max: 5, windowS: 3600, by: 'user' }] },
  async ({ session }) => {
    const token = `cvb_${randomToken(32)}`;
    const [row] = await (await db()).query<{ id: string }>(
      'insert into beacon_tokens (github_id, token_hash) values ($1, $2) returning id',
      [session!.githubId, sha256(token)],
    );
    return { id: row!.id, token };
  },
);

export const DELETE = route({ auth: 'claimed' }, async ({ req, session }) => {
  const { id } = await body(req, z.object({ id: z.string().uuid() }));
  await (await db()).query('update beacon_tokens set revoked_at = now() where id = $1 and github_id = $2', [id, session!.githubId]);
  return { revoked: true };
});
