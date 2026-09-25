import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@commitverse/universe-core',
    '@commitverse/contracts',
    '@commitverse/achievements',
    '@commitverse/embed',
    '@commitverse/db',
    '@commitverse/pipeline',
    '@commitverse/shaders',
    '@commitverse/ui-kit',
  ],
  serverExternalPackages: ['@electric-sql/pglite', 'pg-boss', 'pino', 'postgres'],
  images: { remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }] },
  async rewrites() {
    return [{ source: '/@:login', destination: '/star/:login' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), gamepad=(self), fullscreen=(self)',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      { source: '/u/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
    ];
  },
};

export default config;
