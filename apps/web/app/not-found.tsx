import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="pointer-events-auto flex min-h-dvh items-center justify-center px-4">
      <div className="glass max-w-sm p-6 text-center">
        <div className="label">404</div>
        <h1 className="mt-1 text-lg font-semibold text-[var(--ink-1)]">No such signal in the sky</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">That coordinate is empty space.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-[var(--accent)]">
          Back to the universe
        </Link>
      </div>
    </div>
  );
}
