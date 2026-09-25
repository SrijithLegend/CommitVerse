/**
 * §5.2 "Observatory Instrument" UI kit: monochrome glass panels, thin hairlines, one accent (#7cc4ff).
 * Colour on screen comes only from data (blackbody stars, linguist planets) — hence ClassChip/StarDot take a temperature.
 */
import * as RDialog from '@radix-ui/react-dialog';
import * as RSlider from '@radix-ui/react-slider';
import * as RSwitch from '@radix-ui/react-switch';
import * as RTabs from '@radix-ui/react-tabs';
import * as RTooltip from '@radix-ui/react-tooltip';
import { kelvinToHex } from '@commitverse/universe-core';
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';

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

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-[background,border-color,color,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-[#7cc4ff] text-[#03040a] hover:bg-[#9dd3ff]',
        variant === 'ghost' && 'border border-[rgba(160,190,255,0.16)] bg-[rgba(10,14,26,0.55)] text-[#e8ecf6] hover:border-[rgba(124,196,255,0.5)]',
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

export function Panel({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'aside' } & Record<string, unknown>) {
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
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-[rgba(160,190,255,0.12)] px-2 py-0.5 font-mono text-[11px] text-[#e8ecf6]', className)}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: kelvinToHex(temperature), boxShadow: `0 0 8px ${kelvinToHex(temperature)}` }} />
      {label}
    </span>
  );
}

export function StarDot({ temperature, size = 10 }: { temperature: number; size?: number }) {
  const c = kelvinToHex(temperature);
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: c, boxShadow: `0 0 ${size}px ${c}` }} />;
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
export function Gauge({ label, value, max, display, color = '#7cc4ff', caption }: { label: string; value: number; max: number; display: ReactNode; color?: string; caption?: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num font-mono text-[13px] text-[#e8ecf6]">{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[rgba(160,190,255,0.08)]" role="meter" aria-label={label} aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      {caption && <div className="mt-1 text-[11px] text-[#5b6480]">{caption}</div>}
    </div>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,4,10,0.55)] backdrop-blur-[2px] data-[state=open]:animate-[fadeIn_160ms]" />
        <RDialog.Content
          className={cx(
            'glass fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5 focus:outline-none',
            wide ? 'max-w-3xl' : 'max-w-md',
          )}
        >
          <RDialog.Title className="text-base font-semibold text-[#e8ecf6]">{title}</RDialog.Title>
          {description && <RDialog.Description className="mt-1 text-sm text-[#9aa4bd]">{description}</RDialog.Description>}
          <div className="mt-4">{children}</div>
          <RDialog.Close className="absolute right-3 top-3 rounded-md px-2 py-1 text-[#9aa4bd] hover:text-[#e8ecf6]" aria-label="Close">
            ✕
          </RDialog.Close>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Tabs({ tabs, value, onValueChange, children, className }: { tabs: { value: string; label: string }[]; value: string; onValueChange: (v: string) => void; children?: ReactNode; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RTabs.List className="flex gap-1 overflow-x-auto border-b border-[rgba(160,190,255,0.1)]" aria-label="Tabs">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="relative whitespace-nowrap px-3 py-2 text-[13px] text-[#9aa4bd] transition-colors hover:text-[#e8ecf6] data-[state=active]:text-[#e8ecf6] data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:-bottom-px data-[state=active]:after:h-px data-[state=active]:after:bg-[#7cc4ff]"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <label htmlFor={id} className="text-sm text-[#e8ecf6]">
        {label}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 shrink-0 rounded-full border border-[rgba(160,190,255,0.2)] bg-[rgba(160,190,255,0.08)] transition-colors data-[state=checked]:bg-[#7cc4ff]"
      >
        <RSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-[#e8ecf6] transition-transform data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-[#03040a]" />
      </RSwitch.Root>
    </div>
  );
}

export function Slider({ value, onValueChange, min = 0, max = 1, step = 0.01, label }: { value: number; onValueChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return (
    <div className="py-1.5">
      <div className="mb-2 flex justify-between text-sm">
        <span className="text-[#e8ecf6]">{label}</span>
        <span className="num font-mono text-[#9aa4bd]">{Math.round(((value - min) / (max - min)) * 100)}%</span>
      </div>
      <RSlider.Root className="relative flex h-4 w-full touch-none items-center" value={[value]} min={min} max={max} step={step} onValueChange={(v) => onValueChange(v[0]!)} aria-label={label}>
        <RSlider.Track className="relative h-1 grow rounded-full bg-[rgba(160,190,255,0.12)]">
          <RSlider.Range className="absolute h-full rounded-full bg-[#7cc4ff]" />
        </RSlider.Track>
        <RSlider.Thumb className="block h-3.5 w-3.5 rounded-full bg-[#e8ecf6] shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7cc4ff]" />
      </RSlider.Root>
    </div>
  );
}

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="glass z-50 max-w-xs px-2.5 py-1.5 text-xs text-[#e8ecf6]">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-[rgba(160,190,255,0.2)] bg-[rgba(160,190,255,0.06)] px-1.5 py-0.5 font-mono text-[11px] text-[#9aa4bd]">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-[rgba(160,190,255,0.06)]', className)} />;
}

export const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
export const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
