/**
 * §5.2 "Observatory Instrument" UI kit: monochrome glass panels, thin hairlines, one accent (#7cc4ff).
 * Colour on screen comes only from data (blackbody stars, linguist planets) — hence ClassChip/StarDot take a temperature.
 */

import { kelvinToHex } from '@commitverse/universe-core';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

export const TOKENS = {
  space0: '#03040a',
  space1: '#070a14',
  panel: 'rgba(10, 14, 26, 0.72)',
  panelBorder: 'rgba(160, 190, 255, 0.10)',
  ink1: '#e8ecf6',
  ink2: '#9aa4bd',
  ink3: '#5b6480',
  accent: '#7cc4ff',
  warn: '#ffb86b',
  danger: '#ff6b81',
  radius: '10px',
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-[background,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-[#7cc4ff] text-[#03040a] hover:bg-[#9dd3ff]',
        variant === 'ghost' &&
          'border border-[rgba(160,190,255,0.16)] bg-[rgba(10,14,26,0.55)] text-[#e8ecf6] hover:border-[rgba(124,196,255,0.5)]',
        variant === 'quiet' && 'text-[#9aa4bd] hover:text-[#e8ecf6]',
        variant === 'danger' && 'border border-[rgba(255,107,129,0.4)] text-[#ff6b81] hover:bg-[rgba(255,107,129,0.08)]',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function Panel({
  className,
  children,
  as: As = 'div',
  ...rest
}: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'aside' } & Record<string, unknown>) {
  return (
    <As className={cx('glass', className)} {...rest}>
      {children}
    </As>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('label', className)}>{children}</div>;
}

/** Spectral class chip: the class letter always sits next to the colour (colour is never the only channel, F19). */
export function ClassChip({ temperature, label, className }: { temperature: number; label: string; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-[rgba(160,190,255,0.12)] px-2 py-0.5 font-mono text-[11px] text-[#e8ecf6]',
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: kelvinToHex(temperature), boxShadow: `0 0 8px ${kelvinToHex(temperature)}` }}
      />
      {label}
    </span>
  );
}

export function StarDot({ temperature, size = 10 }: { temperature: number; size?: number }) {
  const c = kelvinToHex(temperature);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: c, boxShadow: `0 0 ${size}px ${c}` }}
    />
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="num mt-1 truncate font-mono text-lg text-[#e8ecf6]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[#5b6480]">{hint}</div>}
    </div>
  );
}

/** Mini gauge for the three-axis readout. */
export function Gauge({
  label,
  value,
  max,
  display,
  color = '#7cc4ff',
  caption,
}: {
  label: string;
  value: number;
  max: number;
  display: ReactNode;
  color?: string;
  caption?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num font-mono text-[13px] text-[#e8ecf6]">{display}</span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-[rgba(160,190,255,0.08)]"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      {caption && <div className="mt-1 text-[11px] text-[#5b6480]">{caption}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[rgba(160,190,255,0.2)] bg-[rgba(160,190,255,0.06)] px-1.5 py-0.5 font-mono text-[11px] text-[#9aa4bd]">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-[rgba(160,190,255,0.06)]', className)} />;
}

export const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
/** Fixed locale + UTC so server-rendered text hydrates identically in every browser locale/timezone. */
export const fmtDate = (iso: string | number | Date, time = false) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}), timeZone: 'UTC' }).format(
    new Date(iso),
  ) + (time ? ' UTC' : '');
export const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
