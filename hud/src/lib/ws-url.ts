import { getClientId } from './client-identity';
import { useAuth } from './auth';

/**
 * Computes a WebSocket URL for a server path.
 * - If NEXT_PUBLIC_JARVIS_WS is set, its origin (and any query) is kept and the
 *   path is replaced with `path`.
 * - Otherwise derive ws[s]://<current host><path> (same-origin proxy).
 * - Appends ?token=... if an auth token is configured, plus the clientId.
 */
export function computeWsUrlFor(path: string): string {
  const env = process.env['NEXT_PUBLIC_JARVIS_WS'];
  let url: string;
  if (env) {
    const qIndex = env.indexOf('?');
    const base = qIndex >= 0 ? env.slice(0, qIndex) : env;
    const query = qIndex >= 0 ? env.slice(qIndex) : '';
    const origin = base.replace(/\/ws(\/.*)?$/, '').replace(/\/+$/, '');
    url = `${origin}${path}${query}`;
  } else if (typeof window === 'undefined') {
    url = `ws://localhost:3001${path}`;
  } else {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url = `${proto}//${window.location.host}${path}`;
  }
  const token = useAuth.getState().token;
  if (token) {
    url += url.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`;
  }
  return `${url}${url.includes('?') ? '&' : '?'}clientId=${encodeURIComponent(getClientId())}`;
}

export function computeWsUrl(): string {
  return computeWsUrlFor('/ws');
}

/** Live Chromium screencast channel. */
export function computeBrowserWsUrl(): string {
  return computeWsUrlFor('/ws/browser');
}
