import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';
import { SettingsView } from '@/ui/SettingsView';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default function Settings() {
  return (
    <PageShell title="Settings" kicker="Graphics · motion · audio · privacy · profile">
      <SceneIntent intent={{ type: 'dim' }} dim />
      <Suspense>
        <SettingsView />
      </Suspense>
    </PageShell>
  );
}
