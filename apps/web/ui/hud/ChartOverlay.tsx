'use client';
import { Dialog } from '@commitverse/ui-kit';
import { useRouter } from 'next/navigation';
import { useUniverse } from '@/stores/universe';
import { StarChart } from '../chart/StarChart';

/** The `M` overlay: the 2D chart; picking a star warps to it. */
export function ChartOverlay() {
  const router = useRouter();
  const close = () => useUniverse.getState().set({ overlay: null });
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Star chart" description="Drag to pan, scroll to zoom, click a star to warp." wide>
      <StarChart
        height={460}
        onPick={(login) => {
          close();
          router.push(`/@${login}`);
        }}
      />
    </Dialog>
  );
}
