import type { Metadata } from 'next';
import { Bench } from '@/ui/Bench';

export const metadata: Metadata = { title: 'Benchmark', robots: { index: false } };

/** §13.1 /bench: a scripted flight (supercluster → galaxy → system → flight) recording fps p50/p5 and frame CPU time. */
export default function BenchPage() {
  return <Bench />;
}
