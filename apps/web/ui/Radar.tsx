/** F12 radar: six axes normalised to universe percentiles; each series in its star's own colour. */
import { kelvinToHex } from '@commitverse/universe-core';

export function Radar({
  axes,
  series,
  size = 240,
}: {
  axes: string[];
  series: { label: string; temperature: number; values: number[] }[];
  size?: number;
}) {
  const c = size / 2;
  const r = size / 2 - 30;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  return (
    <figure>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto w-full max-w-[260px]"
        role="img"
        aria-label={`Radar: ${series.map((s) => `${s.label} ${s.values.map((v, i) => `${axes[i]} ${Math.round(v * 100)}th`).join(', ')}`).join('; ')}`}
      >
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <polygon key={k} points={axes.map((_, i) => pt(i, k).join(',')).join(' ')} fill="none" stroke="rgba(160,190,255,0.1)" />
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 1.15);
          return (
            <text
              key={a}
              x={x}
              y={y}
              fill="#9aa4bd"
              fontSize="9"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="ui-monospace, monospace"
            >
              {a.toUpperCase()}
            </text>
          );
        })}
        {series.map((s) => {
          const col = kelvinToHex(s.temperature);
          return (
            <polygon
              key={s.label}
              points={s.values.map((v, i) => pt(i, Math.max(0.02, v)).join(',')).join(' ')}
              fill={col}
              fillOpacity={0.15}
              stroke={col}
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 font-mono text-[var(--ink-2)]">
            <span className="h-2 w-2 rounded-full" style={{ background: kelvinToHex(s.temperature) }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
