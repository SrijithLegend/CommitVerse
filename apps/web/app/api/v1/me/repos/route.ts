import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

/** Own public repos (for the pinned-planets override). */
export const GET = route({ auth: 'claimed' }, async ({ session }) => ({
  repos: await (await db()).query<{ id: number; name: string; stars: number; planet_slot: number | null }>(
    'select github_repo_id as id, name, stars, planet_slot from repos where owner_id = $1 order by stars desc limit 100',
    [session!.githubId],
  ),
}));
