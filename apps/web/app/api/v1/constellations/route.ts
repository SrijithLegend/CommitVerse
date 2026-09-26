/**
 * §3.5 constellations (orgs with ≥ 3 mapped members): lines are the minimum spanning tree of member positions
 * (never a complete graph), top 64 members by impact. Also returns active binary pairs (far-view filaments).
 */
import { minimumSpanningTree as mst } from '@commitverse/universe-core';
import { z } from 'zod';
import { query, route } from '@/lib/server/api';
import { db } from '@/lib/server/app';

const Q = z.object({ galaxy: z.coerce.number().int().positive().optional(), org: z.string().max(39).optional() });

type P = [number, number, number];

export const GET = route(
  { limits: [{ name: 'constellations', max: 60, windowS: 60 }], cache: 'public, s-maxage=600, stale-while-revalidate=1200' },
  async ({ url }) => {
    const q = query(url, Q);
    const d = await db();
    const orgs = await d.query<{ org_id: number; login: string; name: string | null; n: number }>(
      `select o.github_org_id as org_id, o.login::text as login, o.name, count(*)::int as n
     from org_members m join orgs o on o.github_org_id = m.org_id join bodies b on b.github_id = m.github_id
     join github_users u on u.github_id = m.github_id
     where not u.is_opted_out and ($1::int is null or b.galaxy_id = $1) and ($2::text is null or o.login = $2)
     group by o.github_org_id, o.login, o.name having count(*) >= 3
     order by count(*) desc limit $3`,
      [q.galaxy ?? null, q.org ?? null, q.org ? 1 : 12],
    );
    const constellations = [];
    for (const o of orgs) {
      const members = await d.query<{ github_id: number; login: string; x: number; y: number; z: number }>(
        `select b.github_id, u.login::text as login, b.x, b.y, b.z from org_members m join bodies b using (github_id)
       join github_users u using (github_id) where m.org_id = $1 and not u.is_opted_out order by b.impact desc limit 64`,
        [o.org_id],
      );
      const pts = members.map((m) => [m.x, m.y, m.z] as P);
      constellations.push({
        org: o.login,
        name: o.name,
        members: members.map((m) => ({ githubId: m.github_id, login: m.login, position: [m.x, m.y, m.z] })),
        edges: mst(pts),
      });
    }
    const binaries = await d.query<{ ax: number; ay: number; az: number; bx: number; by: number; bz: number; a: string; b: string }>(
      `select ba.x as ax, ba.y as ay, ba.z as az, bb.x as bx, bb.y as by, bb.z as bz, ua.login::text as a, ub.login::text as b
     from bindings k join bodies ba on ba.github_id = k.a_id join bodies bb on bb.github_id = k.b_id
     join github_users ua on ua.github_id = k.a_id join github_users ub on ub.github_id = k.b_id
     where k.status = 'active' and ($1::int is null or ba.galaxy_id = $1 or bb.galaxy_id = $1) limit 500`,
      [q.galaxy ?? null],
    );
    return {
      constellations,
      binaries: binaries.map((b) => ({ a: b.a, b: b.b, from: [b.ax, b.ay, b.az], to: [b.bx, b.by, b.bz] })),
    };
  },
);
