import { Login, type Position } from '@commitverse/contracts';
import { route } from '@/lib/server/api';
import { db } from '@/lib/server/app';
import { ApiError } from '@/lib/server/errors';
import { requireStar } from '@/lib/server/stars';

export const GET = route<{ login: string }>(
  { limits: [{ name: 'position', max: 60, windowS: 60 }], cache: 'public, s-maxage=60, stale-while-revalidate=300' },
  async ({ params }): Promise<Position> => {
    const d = await db();
    const u = await requireStar(d, Login.parse(params.login));
    const [b] = await d.query<{ galaxy_id: number; x: number; y: number; z: number; provisional: boolean; bake_version: string }>(
      'select galaxy_id, x, y, z, provisional, bake_version from bodies where github_id = $1',
      [u.githubId],
    );
    if (!b) throw new ApiError(404, 'not_placed', 'Not placed yet');
    return { githubId: u.githubId, galaxyId: b.galaxy_id, x: b.x, y: b.y, z: b.z, provisional: b.provisional, bakeVersion: b.bake_version };
  },
);
