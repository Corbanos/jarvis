import { useAuth } from './auth';

/**
 * Computes the WebSocket URL.
 * - If NEXT_PUBLIC_JARVIS_WS is set, use it.
 * - Otherwise derive ws[s]://<current host>/ws (same-origin proxy).
 * - Appends ?token=... if auth token is configured.
 */
export function computeWsUrl(): string {
  const env = process.env['NEXT_PUBLIC_JARVIS_WS'];
  let url: string;
  if (env) {
    url = env;
  } else if (typeof window === 'undefined') {
    url = 'ws://localhost:3001/ws';
  } else {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url = `${proto}//${window.location.host}/ws`;
  }
  const token = useAuth.getState().token;
  if (token) {
    url += url.includes('?') ? `&token=${encodeURIComponent(token)}` : `?token=${encodeURIComponent(token)}`;
  }
  return url;
}
