import type { Metadata } from 'next';
import { FeedList } from '@/ui/FeedList';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Cosmic feed', description: 'Claims, supernovas, binaries, releases — live.' };

export default function Feed() {
  return (
    <PageShell title="Cosmic feed" kicker="Live">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <FeedList />
    </PageShell>
  );
}
