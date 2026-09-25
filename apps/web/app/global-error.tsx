'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#03040a', color: '#e8ecf6', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 20 }}>The universe failed to load</h1>
          <button type="button" onClick={reset} style={{ color: '#7cc4ff', background: 'none', border: 0, cursor: 'pointer', fontSize: 15 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
