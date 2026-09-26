/** Radix-based widgets, split from the barrel so pages that don't use them stay out of the landing bundle (§12). */
import * as RDialog from '@radix-ui/react-dialog';
import * as RSlider from '@radix-ui/react-slider';
import * as RSwitch from '@radix-ui/react-switch';
import * as RTabs from '@radix-ui/react-tabs';
import * as RTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { Button, cx } from './index';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
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

export function Tabs({
  tabs,
  value,
  onValueChange,
  children,
  className,
}: {
  tabs: { value: string; label: string }[];
  value: string;
  onValueChange: (v: string) => void;
  children?: ReactNode;
  className?: string;
}) {
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
      {/* the active panel, so the selected tab's aria-controls resolves (axe aria-valid-attr-value) */}
      <RTabs.Content value={value} className="outline-none">
        {children}
      </RTabs.Content>
    </RTabs.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
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

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
}: {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}) {
  return (
    <div className="py-1.5">
      <div className="mb-2 flex justify-between text-sm">
        <span className="text-[#e8ecf6]">{label}</span>
        <span className="num font-mono text-[#9aa4bd]">{Math.round(((value - min) / (max - min)) * 100)}%</span>
      </div>
      <RSlider.Root
        className="relative flex h-4 w-full touch-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0]!)}
        aria-label={label}
      >
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
    // self-contained provider: no app-wide provider, so radix stays out of the landing bundle (§12)
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content sideOffset={6} className="glass z-50 max-w-xs px-2.5 py-1.5 text-xs text-[#e8ecf6]">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
