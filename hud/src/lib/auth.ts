/**
 * Client-side auth — stores access token in localStorage,
 * adds it to fetch and WebSocket calls.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string;
  setToken: (t: string) => void;
  clearToken: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: '',
      setToken: (token) => set({ token }),
      clearToken: () => set({ token: '' }),
    }),
    { name: 'jarvis-auth' }
  )
);

/** Wrap fetch to add the access token header. */
export function authFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().token;
  if (token) {
    const headers = new Headers(init.headers);
    headers.set('X-Jarvis-Token', token);
    init.headers = headers;
  }
  return fetch(input, init);
}

/** Append ?token=... to a URL if auth is enabled. */
export function withAuthToken(url: string): string {
  const token = useAuth.getState().token;
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
