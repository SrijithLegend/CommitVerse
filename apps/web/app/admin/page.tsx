import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/server/auth';
import { AdminConsole } from '@/ui/AdminConsole';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Admin', robots: { index: false } };

/** F20: allow-listed logins (ADMIN_GITHUB_LOGINS) AND role = 'admin', 8-hour sessions. Everyone else gets a 404. */
export default async function Admin() {
  const s = await getSession();
  if (!s?.isAdmin) notFound();
  return (
    <PageShell title="Admin console" kicker={`Signed in as @${s.login} · every action is audited`} wide>
      <SceneIntent intent={{ type: 'dim' }} dim />
      <AdminConsole />
    </PageShell>
  );
}
