'use client';
import { useEffect, useRef, useState } from 'react';
import { useJarvisStore } from '@/lib/store';

interface WorldviewState {
  open: boolean;
  focus?: { lat: number; lon: number; name: string };
  nonce: number;
}

// We use a simple custom event (so we don't have to plumb through every store)
const WV_EVENT = 'jarvis-worldview-event';

export function emitWorldviewEvent(payload: { action: string; lat?: number; lon?: number; name?: string }) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WV_EVENT, { detail: payload }));
  }
}

export function Worldview() {
  const [state, setState] = useState<WorldviewState>({ open: false, nonce: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action: string; lat?: number; lon?: number; name?: string };
      if (detail.action === 'open') {
        setState((s) => ({ ...s, open: true, nonce: s.nonce + 1 }));
      } else if (detail.action === 'close') {
        setState((s) => ({ ...s, open: false }));
      } else if (detail.action === 'focus' && detail.lat !== undefined && detail.lon !== undefined) {
        setState((s) => ({ open: true, focus: { lat: detail.lat!, lon: detail.lon!, name: detail.name ?? '' }, nonce: s.nonce + 1 }));
        // Forward to iframe via postMessage
        iframeRef.current?.contentWindow?.postMessage({
          type: 'worldview:focus',
          lat: detail.lat,
          lon: detail.lon,
          name: detail.name,
        }, '*');
      }
    };
    window.addEventListener(WV_EVENT, handler);
    return () => window.removeEventListener(WV_EVENT, handler);
  }, []);

  if (!state.open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#000',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', background: 'rgba(0,8,18,0.95)',
        borderBottom: '1px solid rgba(0,229,255,0.3)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.3em', color: 'var(--accent-primary)', fontWeight: 700, textShadow: '0 0 8px rgba(0,229,255,0.5)' }}>
            ◇ WORLDVIEW · GEOSPATIAL INTEL
          </span>
          {state.focus && (
            <span style={{ fontSize: 9, color: 'var(--accent-amber)', letterSpacing: '0.15em' }}>
              FOCUS: {state.focus.name.toUpperCase()}
            </span>
          )}
        </div>
        <button
          onClick={() => setState((s) => ({ ...s, open: false }))}
          style={{
            background: 'rgba(255,59,59,0.08)',
            border: '1px solid rgba(255,59,59,0.4)',
            color: 'var(--accent-red)',
            padding: '5px 14px',
            fontSize: 10,
            letterSpacing: '0.2em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 700,
            borderRadius: 3,
          }}
        >
          ✕ CLOSE
        </button>
      </div>

      {/* Iframe — Palantir's full app */}
      <iframe
        ref={iframeRef}
        src="/worldview/index.html"
        style={{ flex: 1, border: 'none', background: '#000' }}
        title="WORLDVIEW"
      />
    </div>
  );
}

/**
 * Listens to the WS dismiss/worldview events on the store and dispatches
 * window events that the Worldview overlay picks up.
 *
 * Hook this in once at the dashboard level.
 */
export function useWorldviewWS() {
  const dismissNonce = useJarvisStore((s) => s.dismissNonce);
  // We use a separate store entry for worldview so we don't bake more into the global store
  // For now: subscribe to raw WS events via window
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (typeof e.data === 'string') return;
      const data = e.data;
      if (data?.type === 'worldview') {
        emitWorldviewEvent(data.payload ?? {});
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [dismissNonce]);
}
