import type { Metadata } from 'next';
import { BeaconApprove } from '@/ui/BeaconApprove';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Connect Beacon', robots: { index: false } };

export default async function Beacon({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <PageShell title="Connect the VS Code Beacon" kicker="Device sign-in">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <BeaconApprove initialCode={code && /^[A-Z]{4}-[A-Z]{4}$/.test(code) ? code : ''} />
    </PageShell>
  );
}
