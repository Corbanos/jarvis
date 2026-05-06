'use client';
import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '@/lib/auth';
import { summon } from '@/lib/workspace';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface AppManifest {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  ready?: boolean;
  width?: number;
  height?: number;
  updatedAt?: number;
}

export function LibraryModule() {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/api/library`);
      const j = await r.json() as { apps: AppManifest[] };
      setApps(j.apps);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (loading) return <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em' }}>LOADING…</div>;
  if (!apps.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>◆</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>LIBRARY EMPTY</div>
        <div style={{ fontSize: 9, marginTop: 8, opacity: 0.7, lineHeight: 1.6, padding: '0 12px' }}>
          Apps Jarvis builds for you (via the Projects module) appear here. Try saying:<br/>
          <span style={{ color: 'var(--accent-amber)' }}>“start a project to make me a tetris game”</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, alignContent: 'start' }}>
      {apps.map((a) => <AppTile key={a.slug} app={a} onLaunch={() => summon('app', { slug: a.slug })} />)}
    </div>
  );
}

function AppTile({ app, onLaunch }: { app: AppManifest; onLaunch: () => void }) {
  const built = !!app.ready;
  return (
    <div
      onClick={built ? onLaunch : undefined}
      style={{
        position: 'relative',
        background: 'rgba(0,12,24,0.6)',
        border: `1px solid rgba(0,229,255,${built ? 0.25 : 0.1})`,
        borderRadius: 4,
        padding: 10,
        cursor: built ? 'pointer' : 'not-allowed',
        opacity: built ? 1 : 0.55,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => { if (built) e.currentTarget.style.borderColor = 'rgba(0,229,255,0.6)'; }}
      onMouseLeave={(e) => { if (built) e.currentTarget.style.borderColor = 'rgba(0,229,255,0.25)'; }}
    >
      <div style={{
        background: 'rgba(0,4,12,0.85)',
        border: '1px solid rgba(0,229,255,0.15)',
        borderRadius: 3, aspectRatio: '4/3',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 38, color: 'var(--accent-primary)',
      }}>
        {app.icon ?? '◆'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--accent-bright)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {app.name}
      </div>
      {app.description && (
        <div style={{ fontSize: 8, color: 'var(--text-dim)', lineHeight: 1.4, height: 22, overflow: 'hidden' }}>
          {app.description}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 7, letterSpacing: '0.15em' }}>
        <span style={{ color: built ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
          ● {built ? 'READY' : 'BUILDING'}
        </span>
        {built && <span style={{ color: 'var(--accent-primary)' }}>▶ LAUNCH</span>}
      </div>
    </div>
  );
}
