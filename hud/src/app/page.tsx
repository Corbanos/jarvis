'use client';
import { useEffect, useState } from 'react';
import { useJarvisWS } from '@/hooks/useJarvisWS';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useActiveProject } from '@/hooks/useActiveProject';
import { useJarvisStore } from '@/lib/store';
import { useAudioLevel } from '@/lib/audio-level';
import { HexGrid } from '@/components/HexGrid';
import { StatusBar } from '@/components/StatusBar';
import { ArcReactor } from '@/components/ArcReactor';
import { SetupScreen } from '@/components/SetupScreen';
import { Worldview } from '@/components/Worldview';
import { Workspace } from '@/components/Workspace';
import { authFetch } from '@/lib/auth';
import { useAuth } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';
type AppState = 'checking' | 'auth' | 'setup' | 'ready';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('checking');

  useEffect(() => {
    // First check whether auth is enabled and we have a valid token
    fetch(`${API}/api/auth/info`)
      .then((r) => r.json())
      .then(async (info: { enabled: boolean }) => {
        if (info.enabled) {
          const token = useAuth.getState().token;
          if (!token) { setAppState('auth'); return; }
          const verify = await fetch(`${API}/api/auth/check`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }).then((r) => r.json() as Promise<{ ok: boolean }>);
          if (!verify.ok) { setAppState('auth'); return; }
        }
        // Then check API key config
        const setupStatus = await authFetch(`${API}/api/setup/status`).then((r) => r.json() as Promise<{ configured: boolean; valid: boolean }>);
        setAppState(setupStatus.configured && setupStatus.valid ? 'ready' : 'setup');
      })
      .catch(() => setAppState('auth'));
  }, []);

  if (appState === 'checking') return <BootScreen />;
  if (appState === 'auth') return <AuthScreen onComplete={() => setAppState('checking')} />;
  if (appState === 'setup') return <SetupScreen onComplete={() => setAppState('ready')} />;
  return <HQ />;
}

function BootScreen() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#00e5ff', letterSpacing: '0.3em', marginBottom: 12, opacity: 0.6 }}>
          J.A.R.V.I.S.
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#00e5ff', animation: `thinking-pulse 1s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HQ() {
  useJarvisWS();
  useChatHistory('default');
  useGeolocation();
  useActiveProject();

  const connected = useJarvisStore((s) => s.connected);
  const source = useAudioLevel((s) => s.source);
  const level = useAudioLevel((s) => s.level);

  const sourceLabel = source === 'jarvis' ? 'JARVIS SPEAKING' : source === 'user' ? 'USER SPEAKING' : connected ? 'STANDING BY' : 'OFFLINE';
  const sourceColor = source === 'jarvis' ? 'var(--accent-bright)' : source === 'user' ? 'var(--accent-amber)' : connected ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden', position: 'relative' }}>

      {/* Backgrounds */}
      <HexGrid />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.7) 100%)' }} />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,229,255,0.012) 0px, transparent 1px, transparent 28px)' }} />

      {/* Worldview overlay (full-screen when active) */}
      <Worldview />

      {/* Status bar */}
      <div style={{ position: 'relative', zIndex: 50 }}>
        <StatusBar />
      </div>

      {/* Centered ambient arc reactor (sits behind floating modules) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}>
        <ArcReactor size={420} />
        {/* Audio source label below reactor */}
        <div style={{
          marginTop: 36,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 10, letterSpacing: '0.4em',
          color: sourceColor,
          fontWeight: 700,
          transition: 'color 0.2s',
          textShadow: `0 0 8px ${sourceColor}80`,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: sourceColor,
            boxShadow: `0 0 ${6 + level * 18}px ${sourceColor}`,
            transition: 'box-shadow 0.1s',
          }} />
          {sourceLabel}
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: sourceColor,
            boxShadow: `0 0 ${6 + level * 18}px ${sourceColor}`,
            transition: 'box-shadow 0.1s',
          }} />
        </div>
        {/* Reactor info corners */}
        <div style={{ position: 'fixed', top: 70, left: 16, fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.25em', pointerEvents: 'none' }}>
          ◇ ARC REACTOR · MK-42  ·  OUTPUT 3.07 GJ/s
        </div>
      </div>

      {/* Floating modules layer (workspace) */}
      <div style={{ position: 'absolute', inset: 0, top: 56, zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 56px)', pointerEvents: 'none' }}>
          {/* Re-enable pointer events on actual panels via children — react-rnd handles its own pointer events */}
          <div style={{ width: '100%', height: '100%', position: 'absolute' }}>
            <PointerEnabledLayer>
              <Workspace />
            </PointerEnabledLayer>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper that allows pointer events on its children but not on its own background. */
function PointerEnabledLayer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
      {children}
    </div>
  );
}

function AuthScreen({ onComplete }: { onComplete: () => void }) {
  const setToken = useAuth((s) => s.setToken);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    const t = input.trim();
    if (!t) return;
    setChecking(true); setError('');
    try {
      const res = await fetch(`${API}/api/auth/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      });
      const data = await res.json() as { ok: boolean };
      if (data.ok) { setToken(t); onComplete(); }
      else setError('Invalid access token.');
    } catch (e) { setError('Cannot reach JARVIS server.'); }
    finally { setChecking(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 520, background: 'rgba(0,8,18,0.95)', border: '1px solid rgba(0,229,255,0.3)', borderRadius: 4, padding: 28, boxShadow: '0 0 40px rgba(0,229,255,0.15)' }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.3em', color: '#00e5ff', textAlign: 'center', marginBottom: 6, textShadow: '0 0 20px rgba(0,229,255,0.5)' }}>J.A.R.V.I.S.</div>
        <div style={{ fontSize: 9, color: 'rgba(255,140,0,0.8)', letterSpacing: '0.3em', textAlign: 'center', marginBottom: 22, fontWeight: 700 }}>
          ◇ ACCESS TOKEN REQUIRED
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 14, lineHeight: 1.6 }}>
          This JARVIS instance is gated. Enter your access token to continue.
          The token is set on the host machine via the local terminal.
        </div>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (error) setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Access token"
          autoFocus
          style={{ width: '100%', background: 'rgba(0,15,35,0.8)', border: `1px solid ${error ? 'rgba(255,34,68,0.5)' : 'rgba(0,229,255,0.3)'}`, borderRadius: 3, padding: '10px 12px', color: '#d0eeff', fontSize: 12, fontFamily: 'inherit', letterSpacing: '0.08em', outline: 'none', marginBottom: 8 }}
        />
        {error && <div style={{ fontSize: 10, color: '#ff4466', marginBottom: 10, letterSpacing: '0.1em' }}>✗ {error}</div>}
        <button onClick={submit} disabled={checking || !input.trim()} style={{ width: '100%', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.4)', borderRadius: 3, color: '#00e5ff', padding: '10px', fontSize: 11, letterSpacing: '0.25em', fontFamily: 'inherit', fontWeight: 700, cursor: checking ? 'wait' : 'pointer', opacity: !input.trim() ? 0.4 : 1 }}>
          {checking ? 'VERIFYING...' : 'AUTHENTICATE'}
        </button>
        <div style={{ fontSize: 8, color: 'rgba(0,229,255,0.3)', textAlign: 'center', marginTop: 16, letterSpacing: '0.15em' }}>
          TOKEN STORED LOCALLY ON THIS DEVICE  ·  CLEAR VIA SETTINGS
        </div>
      </div>
    </div>
  );
}
