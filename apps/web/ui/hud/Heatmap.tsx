'use client';
/** 52-week contribution heatmap, coloured with the star's own blackbody ramp (UTC days, oldest first). */
import { kelvinToHex } from '@commitverse/universe-core';

export function Heatmap({ days, temperature, cell = 5 }: { days: number[]; temperature: number; cell?: number }) {
  const color = kelvinToHex(temperature);
  const sorted = days.filter((d) => d > 0).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))] ?? 1;
  const levels = [q(0.25), q(0.5), q(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= levels[0]! ? 1 : v <= levels[1]! ? 2 : v <= levels[2]! ? 3 : 4);
  const weeks = Math.ceil(days.length / 7);
  const gap = 1.5;
  const total = days.reduce((a, b) => a + b, 0);
  return (
    <svg
      viewBox={`0 0 ${weeks * (cell + gap)} ${7 * (cell + gap)}`}
      className="mt-1.5 w-full"
      role="img"
      aria-label={`${total.toLocaleString()} contributions in the last 52 weeks`}
    >
      {days.map((v, i) => {
        const l = level(v);
        return (
          <rect
            key={i}
            x={Math.floor(i / 7) * (cell + gap)}
            y={(i % 7) * (cell + gap)}
            width={cell}
            height={cell}
            rx={1}
            fill={l === 0 ? 'rgba(160,190,255,0.06)' : color}
            fillOpacity={l === 0 ? 1 : 0.25 + l * 0.19}
          >
            <title>{`${v} contributions`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
