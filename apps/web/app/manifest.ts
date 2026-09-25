import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Commitverse',
    short_name: 'Commitverse',
    description: 'Every developer is a star.',
    start_url: '/',
    display: 'standalone',
    background_color: '#03040a',
    theme_color: '#03040a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
