/** Glass page container for content pages that sit over the (dimmed) universe. */
import type { ReactNode } from 'react';

export function PageShell({ title, kicker, children, actions, wide = false }: { title: string; kicker?: string; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <div className={`pointer-events-auto mx-auto px-4 pb-24 pt-20 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          {kicker && <div className="label">{kicker}</div>}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink-1)] sm:text-3xl">{title}</h1>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
