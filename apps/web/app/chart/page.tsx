import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChartPage } from '@/ui/chart/ChartPage';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Star chart', description: 'A 2D chart of the whole universe, plus an accessible list mode.' };

export default function Chart() {
  return (
    <PageShell title="Star chart" kicker="2D projection · accessible list mode" wide>
      <SceneIntent intent={{ type: 'dim' }} dim />
      <Suspense>
        <ChartPage />
      </Suspense>
    </PageShell>
  );
}
