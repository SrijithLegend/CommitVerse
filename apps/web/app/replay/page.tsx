import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReplayControls } from '@/ui/ReplayControls';
import { SceneIntent } from '@/ui/SceneIntent';

export const metadata: Metadata = { title: 'Big Bang replay', description: 'Watch the developer universe ignite, from 2008 to today.' };

export default function Replay() {
  return (
    <>
      <SceneIntent intent={{ type: 'replay' }} />
      <Suspense>
        <ReplayControls />
      </Suspense>
    </>
  );
}
