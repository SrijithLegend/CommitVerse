'use client';
import { type ReactNode, useEffect, useState } from 'react';

interface Toast {
  id: number;
  content: ReactNode;
  action?: { label: string; onClick: () => void };
  tone?: 'info' | 'error';
}

let push: ((t: Omit<Toast, 'id'>) => void) | null = null;
let seq = 0;

export function toast(content: ReactNode, opts: { action?: Toast['action']; tone?: Toast['tone'] } = {}) {
  push?.({ content, ...opts });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = ++seq;
      setItems((s) => [...s.slice(-3), { ...t, id }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.action ? 9000 : 5000);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`glass pointer-events-auto flex animate-[toastIn_200ms_var(--ease)] items-center justify-between gap-3 px-4 py-3 text-sm ${t.tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--ink-1)]'}`}
        >
          <span>{t.content}</span>
          {t.action && (
            <button
              type="button"
              onClick={t.action.onClick}
              className="shrink-0 rounded-md px-2 py-1 text-[var(--accent)] hover:bg-[rgba(124,196,255,0.08)]"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
