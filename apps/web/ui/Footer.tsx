import Link from 'next/link';

/** §1.1 / §11.6: no GitHub marks; the footer MUST say "Not affiliated with or endorsed by GitHub, Inc." */
export function Footer() {
  return (
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-2 text-[11px] text-[var(--ink-3)] sm:justify-end">
      <span className="pointer-events-auto">Not affiliated with or endorsed by GitHub, Inc.</span>
      <nav className="pointer-events-auto flex gap-3" aria-label="Legal">
        <Link href="/legal/terms" className="hover:text-[var(--ink-2)]">
          Terms
        </Link>
        <Link href="/legal/privacy" className="hover:text-[var(--ink-2)]">
          Privacy
        </Link>
        <Link href="/legal/refunds" className="hover:text-[var(--ink-2)]">
          Refunds
        </Link>
        <Link href="/chart?list=1" className="hover:text-[var(--ink-2)]">
          List mode
        </Link>
      </nav>
    </footer>
  );
}
