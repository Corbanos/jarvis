import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const BACKEND = process.env['JARVIS_BACKEND'] ?? 'http://localhost:7777';

/**
 * One id per build, inlined into the client bundle AND the server bundle.
 *
 * It must not be read from .next/BUILD_ID at render time: pages are
 * prerendered during the build, when .next still holds the *previous* build
 * (builds stage into .next-staging). A page would then carry the old id and
 * disagree with the server forever — which read as "a new build shipped" on
 * every window focus and reloaded the tab out from under the operator.
 */
const BUILD_ID = process.env['JARVIS_BUILD_ID'] ?? fallbackBuildId();

/**
 * next.config is evaluated more than once per build (separate client and
 * server passes), so the id must not be computed per evaluation — two passes
 * milliseconds apart produced two different ids, and the page then disagreed
 * with the route forever. The build script pins JARVIS_BUILD_ID for the whole
 * build; this fallback covers a bare `next build` with something equally
 * stable across passes, and finally 'dev', where both sides match and the
 * watcher simply never fires.
 */
function fallbackBuildId(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sha) return `g${sha}`;
  } catch { /* not a git checkout */ }
  return 'dev';
}

const config: NextConfig = {
  // Builds go to a staging dir (NEXT_DIST_DIR=.next-staging) and are swapped
  // into .next atomically alongside the restart. Building straight into .next
  // while `next start` serves from it deletes chunks under the live server —
  // every open HUD then fails with ChunkLoadError until it happens to reload.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  reactStrictMode: false,
  generateBuildId: () => BUILD_ID,
  env: {
    // When same-origin (proxied), use relative URLs
    NEXT_PUBLIC_JARVIS_WS: process.env['NEXT_PUBLIC_JARVIS_WS'] ?? '',
    NEXT_PUBLIC_JARVIS_API: process.env['NEXT_PUBLIC_JARVIS_API'] ?? '',
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
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
