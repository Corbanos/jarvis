'use client';
import { useEffect } from 'react';

const POLL_MS = 60_000;
const RELOAD_GUARD = 'jarvis-chunk-reload';

/**
 * Keeps an open HUD in step with the build that's serving it.
 *
 * After a rebuild + restart the old tab still references the previous build's
 * chunks, which no longer exist — the symptom is ChunkLoadError on the next
 * navigation or lazy load. Two defences: reload when the served build id
 * differs from the one this page was rendered with (checked on a timer, on
 * focus, and when the WebSocket reconnects — i.e. right after a restart), and
 * reload once if a chunk load fails anyway.
 */
export function BuildWatcher({ initial }: { initial: string }) {
  useEffect(() => {
    let disposed = false;

    const check = async () => {
      try {
        const res = await fetch('/build-id', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId: string };
        if (!disposed && buildId && initial !== 'dev' && buildId !== initial) {
          window.location.reload();
        }
      } catch { /* server mid-restart; try again next tick */ }
    };

    const onChunkFailure = (reason: unknown) => {
      const msg = String((reason as { message?: string })?.message ?? reason ?? '');
      const name = String((reason as { name?: string })?.name ?? '');
      if (name !== 'ChunkLoadError' && !/Loading chunk|Loading CSS chunk/i.test(msg)) return;
      try {
        // Once per build: a genuinely broken deploy shouldn't loop forever.
        if (sessionStorage.getItem(RELOAD_GUARD) === initial) return;
        sessionStorage.setItem(RELOAD_GUARD, initial);
      } catch { /* storage unavailable — still worth one reload */ }
      window.location.reload();
    };
    const onRejection = (e: PromiseRejectionEvent) => onChunkFailure(e.reason);
    const onError = (e: ErrorEvent) => onChunkFailure(e.error ?? e.message);

    const timer = setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    window.addEventListener('jarvis-ws-reconnected', check);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('jarvis-ws-reconnected', check);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, [initial]);

  return null;
}
