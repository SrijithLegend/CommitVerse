import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShell } from '@/ui/PageShell';
import { SceneIntent } from '@/ui/SceneIntent';
import { Shop } from '@/ui/Shop';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Cosmetics for your star. Cosmetics never change size, temperature, luminosity, position or rank.',
};

export default function ShopPage() {
  return (
    <PageShell title="Shop" kicker="Coronas · auras · rings · skins · ships · trails" wide>
      <SceneIntent intent={{ type: 'dim' }} />
      <Suspense>
        <Shop />
      </Suspense>
    </PageShell>
  );
}
