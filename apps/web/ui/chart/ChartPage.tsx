'use client';
import { Tabs } from '@commitverse/ui-kit';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUniverse } from '@/stores/universe';
import { StarChart } from './StarChart';
import { StarList } from './StarList';

export function ChartPage() {
  const params = useSearchParams();
  const router = useRouter();
  const webgl = useUniverse((s) => s.webgl);
  const tab = params.get('list') === '1' || webgl === 'unavailable' ? 'list' : 'chart';
  return (
    <>
      {webgl === 'unavailable' && <p className="mb-3 text-sm text-[var(--warn)]">WebGL2 isn’t available on this device, so you’re in accessible list mode.</p>}
      <Tabs
        tabs={[
          { value: 'chart', label: 'Chart' },
          { value: 'list', label: 'List mode' },
        ]}
        value={tab}
        onValueChange={(v) => router.replace(v === 'list' ? '/chart?list=1' : '/chart')}
      />
      <section className="glass mt-4 p-4">{tab === 'list' ? <StarList /> : <StarChart />}</section>
    </>
  );
}
