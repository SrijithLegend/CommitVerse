import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { Footer } from '@/ui/Footer';
import { Hud } from '@/ui/Hud';
import { Providers } from '@/ui/Providers';
import { TopBar } from '@/ui/TopBar';
import { UniverseLoader } from '@/ui/UniverseLoader';
import './globals.css';

const inter = localFont({ src: '../public/fonts/InterTight.ttf', variable: '--font-inter-tight', weight: '400 700', display: 'swap' });
const mono = localFont({ src: '../public/fonts/JetBrainsMono.ttf', variable: '--font-jetbrains-mono', weight: '400 700', display: 'swap' });

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: 'Commitverse — every developer is a star', template: '%s · Commitverse' },
  description:
    'A real-time, explorable 3D universe generated from public GitHub data. Every developer is a star, every repo a planet, every language a galaxy.',
  applicationName: 'Commitverse',
  openGraph: { type: 'website', siteName: 'Commitverse', images: ['/opengraph.png'] },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/icon.svg' },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#03040a', colorScheme: 'dark', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const tilesBase = process.env.NEXT_PUBLIC_TILES_BASE_URL?.replace(/\/$/, '') ?? '';
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-dvh overflow-x-hidden antialiased" data-nonce={nonce ? 'set' : 'none'}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>
          <UniverseLoader tilesBase={tilesBase} />
          <TopBar />
          <Hud />
          <main id="main" className="pointer-events-none relative z-10">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
