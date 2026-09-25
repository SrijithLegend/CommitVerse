'use client';
/** F21 first-visit hint chips (3 max, dismissible, never shown again once dismissed). */
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/client/settings';

const HINTS = [
  { id: 'drag', text: 'Drag to look around' },
  { id: 'search', text: 'Press / to search' },
  { id: 'fly', text: 'Press F to fly' },
];

export function HintChips() {
  const dismissed = useSettings((s) => s.hintsDismissed);
  const dismiss = useSettings((s) => s.dismissHint);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const visible = HINTS.filter((h) => !dismissed.includes(h.id));
  if (!hydrated || !visible.length) return null;
  return (
    <ul className="pointer-events-auto fixed bottom-[132px] left-1/2 z-20 flex -translate-x-1/2 flex-wrap justify-center gap-2 px-4" aria-label="Tips">
      {visible.map((h) => (
        <li key={h.id} className="glass flex items-center gap-2 py-1.5 pl-3 pr-1.5 text-[12px] text-[var(--ink-2)]">
          {h.text}
          <button type="button" onClick={() => dismiss(h.id)} className="rounded p-1 text-[var(--ink-3)] hover:text-[var(--ink-1)]" aria-label={`Dismiss tip: ${h.text}`}>
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
