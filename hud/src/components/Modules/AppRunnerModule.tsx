'use client';
import { useEffect, useState, useRef } from 'react';
import { authFetch } from '@/lib/auth';
import type { ModuleInstance } from '@/lib/workspace';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface AppManifest {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  ready?: boolean;
  entry?: string;
  width?: number;
  height?: number;
  updatedAt?: number;
}

/**
 * Generic in-HUD app runner. Loads /library/<slug>/index.html in an iframe.
 * Receives the slug via module.data.
 *
 * Polls manifest every 4s while the module is open so an app being built
 * by Jarvis hot-refreshes when the agent finishes.
 */
export function AppRunnerModule({ module }: { module: ModuleInstance }) {
  const slug = (module.data?.['slug'] as string | undefined) ?? '';
  const [manifest, setManifest] = useState<AppManifest | null>((module.data?.['manifest'] as AppManifest | undefined) ?? null);
  const [iframeKey, setIframeKey] = useState(0);
  const lastUpdatedRef = useRef<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await authFetch(`${API}/api/library/${slug}/manifest`);
        if (!r.ok) return;
        const m = await r.json() as AppManifest;
        if (stopped) return;
        setManifest(m);
        // Hot-reload iframe if the manifest's updatedAt changed (Jarvis re-wrote files).
        if (m.updatedAt && lastUpdatedRef.current && m.updatedAt > lastUpdatedRef.current) {
          setIframeKey((k) => k + 1);
        }
        lastUpdatedRef.current = m.updatedAt ?? 0;
      } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { stopped = true; clearInterval(t); };
  }, [slug]);

  if (!slug) {
    return <Empty message="No app slug provided." />;
  }

  if (manifest && !manifest.ready) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', color: 'var(--accent-primary)', gap: 12, padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>{manifest.icon ?? '◆'}</div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em' }}>{manifest.name}</div>
        <div style={{ fontSize: 9, color: 'var(--accent-amber)', letterSpacing: '0.2em' }}>● BUILDING</div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', maxWidth: 320, lineHeight: 1.5 }}>
          Jarvis is constructing this app. The window will refresh automatically when it's ready.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#000' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid rgba(0,229,255,0.15)' }}>
        <span style={{ fontSize: 14 }}>{manifest?.icon ?? '◆'}</span>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--accent-bright)', fontWeight: 700 }}>
          {manifest?.name ?? slug}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setIframeKey((k) => k + 1)}
          title="Reload app"
          style={{
            background: 'rgba(0,229,255,0.05)',
            border: '1px solid rgba(0,229,255,0.25)',
            borderRadius: 3, color: 'var(--accent-primary)',
            fontSize: 9, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.15em',
          }}
        >↻ RELOAD</button>
      </div>
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={`${API}/library/${slug}/`}
        title={manifest?.name ?? slug}
        style={{ flex: 1, border: 'none', background: '#000' }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em' }}>
      {message}
    </div>
  );
}
