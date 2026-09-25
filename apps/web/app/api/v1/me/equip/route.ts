import { EquipBody } from '@commitverse/contracts';
import { broadcast } from '@commitverse/pipeline';
import { body, route } from '@/lib/server/api';
import { db, queue } from '@/lib/server/app';
import { equip } from '@/lib/server/economy';

export const POST = route({ auth: 'claimed', limits: [{ name: 'equip', max: 30, windowS: 60, by: 'user' }] }, async ({ req, session }) => {
  const b = await body(req, EquipBody);
  await equip(await db(), session!.githubId, b.slot, b.inventoryId);
  // F6 AC: the equipped state syncs to other clients in ≤ 2 s.
  void broadcast('cosmic:global', 'equip', { githubId: session!.githubId, slot: b.slot });
  if (b.slot === 'corona') await (await queue()).send('delta', {}, { singletonKey: 'delta', startAfterSeconds: 1 });
  return { ok: true };
});
