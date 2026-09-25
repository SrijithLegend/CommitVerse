import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

export const GET = route({ auth: 'user', limits: [{ name: 'notifications', max: 60, windowS: 60, by: 'user' }] }, async ({ session }) => {
  const rows = await (await db()).query<{
    id: number;
    type: string;
    payload: Record<string, unknown>;
    read_at: Date | null;
    created_at: Date;
  }>('select id, type, payload, read_at, created_at from notifications where recipient_id = $1 order by created_at desc limit 50', [
    session!.githubId,
  ]);
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      read: !!r.read_at,
      createdAt: r.created_at.toISOString(),
    })),
    unread: rows.filter((r) => !r.read_at).length,
  };
});
