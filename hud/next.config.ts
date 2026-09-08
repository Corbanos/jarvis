import type { NextConfig } from 'next';

const BACKEND = process.env['JARVIS_BACKEND'] ?? 'http://localhost:7777';

const config: NextConfig = {
  // Builds go to a staging dir (NEXT_DIST_DIR=.next-staging) and are swapped
  // into .next atomically alongside the restart. Building straight into .next
  // while `next start` serves from it deletes chunks under the live server —
  // every open HUD then fails with ChunkLoadError until it happens to reload.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  reactStrictMode: false,
  env: {
    // When same-origin (proxied), use relative URLs
    NEXT_PUBLIC_JARVIS_WS: process.env['NEXT_PUBLIC_JARVIS_WS'] ?? '',
    NEXT_PUBLIC_JARVIS_API: process.env['NEXT_PUBLIC_JARVIS_API'] ?? '',
  },
  async rewrites() {
    return [
      // Proxy all API calls to the backend so the HUD origin = the only origin
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      // Proxy library asset serving (in-HUD apps live at ~/.jarvis/library/<slug>/)
      { source: '/library/:slug/:path*', destination: `${BACKEND}/library/:slug/:path*` },
      { source: '/library/:slug/', destination: `${BACKEND}/library/:slug/` },
      { source: '/library/:slug', destination: `${BACKEND}/library/:slug/` },
      // Proxy WebSocket
      { source: '/ws', destination: `${BACKEND}/ws` },
      // Live browser screencast socket (and any future /ws/* subchannels)
      { source: '/ws/:path*', destination: `${BACKEND}/ws/:path*` },
    ];
  },
};

export default config;
