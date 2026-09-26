'use client';
/** F15 emotes: 4 preset radial-menu emotes (no free-text chat in v1). Only shown when presence is configured. */
import { useState } from 'react';
import { useUniverse } from '@/stores/universe';

const EMOTES = [
  { id: 'wave', label: 'Wave', icon: '👋' },
  { id: 'flare', label: 'Flare', icon: '✦' },
  { id: 'salute', label: 'Salute', icon: '🫡' },
  { id: 'spin', label: 'Barrel roll', icon: '↻' },
] as const;

export function EmoteMenu() {
  const [open, setOpen] = useState(false);
  const presence = useUniverse((s) => s.presence);
  if (!process.env.NEXT_PUBLIC_REALTIME_URL || !presence.sector) return null;
  return (
    <div className="pointer-events-auto fixed bottom-7 right-4 z-30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass h-11 w-11 rounded-full text-lg"
        aria-label="Emotes"
        aria-expanded={open}
      >
        ☺
      </button>
      {open &&
        EMOTES.map((e, i) => {
          const a = Math.PI + (i / (EMOTES.length - 1)) * (Math.PI / 2);
          return (
            <button
              key={e.id}
              type="button"
              aria-label={e.label}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('cv:emote', { detail: e.id }));
                setOpen(false);
              }}
              className="glass absolute h-10 w-10 rounded-full text-base"
              style={{ left: 2 + Math.cos(a) * 70, top: 2 + Math.sin(a) * 70 }}
            >
              {e.icon}
            </button>
          );
        })}
    </div>
  );
}
