'use client';
import { useEffect } from 'react';
import { useJarvisStore } from '@/lib/store';

const POLL_MS = 60_000;
const BUSY_RETRY_MS = 5_000;
const RELOAD_GUARD = 'jarvis-chunk-reload';

/** The build that produced this page — inlined at build time, same constant the server carries. */
const PAGE_BUILD_ID = process.env['NEXT_PUBLIC_BUILD_ID'] ?? '';

/** Pure: is the served build genuinely different from the one running here? */
export function isStaleBuild(pageBuildId: string, servedBuildId: string): boolean {
  if (!pageBuildId || !servedBuildId) return false;   // unknown → never reload
  return pageBuildId !== servedBuildId;
}

/**
 * True while a reload would visibly interrupt the operator: a reply streaming
 * in, or something typed and not yet sent. Agents running in the background
 * don't count — they live on the server and survive a reload.
 */
export function isBusy(doc: Document = document): boolean {
  if (useJarvisStore.getState().thinkingTokens.length > 0) return true;
  const fields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type="text"], input:not([type])');
  for (const el of fields) if (el.value.trim()) return true;
  return false;
}

/**
 * Keeps an open HUD in step with the build that's serving it.
 *
 * After a rebuild the old tab references chunks that no longer exist, and the
 * next lazy load fails. This checks the served build id on a timer, on focus,
 * and when the WebSocket reconnects (right after a restart) — and reloads only
 * once the operator isn't mid-sentence. If a chunk fails anyway, one guarded
 * reload per build recovers it without looping on a broken deploy.
 */
export function BuildWatcher() {
  useEffect(() => {
    let disposed = false;
    let busyTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadWhenIdle = () => {
      if (disposed) return;
      if (isBusy()) {
        if (busyTimer) clearTimeout(busyTimer);
        busyTimer = setTimeout(reloadWhenIdle, BUSY_RETRY_MS);
        return;
      }
      window.location.reload();
    };

    const check = async () => {
      if (disposed || !PAGE_BUILD_ID) return;
      try {
        const res = await fetch('/build-id', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId: string };
        if (isStaleBuild(PAGE_BUILD_ID, buildId)) reloadWhenIdle();
      } catch { /* server mid-restart; try again next tick */ }
    };

    const onChunkFailure = (reason: unknown) => {
      const msg = String((reason as { message?: string })?.message ?? reason ?? '');
      const name = String((reason as { name?: string })?.name ?? '');
      if (name !== 'ChunkLoadError' && !/Loading chunk|Loading CSS chunk/i.test(msg)) return;
      try {
        // Once per build: a genuinely broken deploy shouldn't loop forever.
        if (sessionStorage.getItem(RELOAD_GUARD) === PAGE_BUILD_ID) return;
        sessionStorage.setItem(RELOAD_GUARD, PAGE_BUILD_ID);
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
      if (busyTimer) clearTimeout(busyTimer);
      window.removeEventListener('focus', check);
      window.removeEventListener('jarvis-ws-reconnected', check);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return null;
}
