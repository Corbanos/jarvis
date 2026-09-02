'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function IntegrationsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Integrations — API keys for external services"
        style={{
          background: 'transparent',
          border: '1px solid rgba(0,229,255,0.25)',
          borderRadius: 3,
          color: 'var(--accent-primary)',
          padding: '4px 10px',
          fontSize: 9,
          letterSpacing: '0.2em',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 700,
        }}
      >
        🔌 KEYS
      </button>
      {open && <IntegrationsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * One home for third-party credentials. Each integration is a section that
 * knows how to check, save, and clear its own key; adding another service is
 * another section.
 */
function IntegrationsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(0,8,18,0.98)',
          border: '1px solid rgba(0,229,255,0.3)',
          borderRadius: 4,
          width: '100%', maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 0 60px rgba(0,229,255,0.15)',
        }}
      >
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(0,229,255,0.15)',
          background: 'rgba(0,20,40,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.3em', color: 'var(--accent-primary)', fontWeight: 700 }}>
            ◇ INTEGRATIONS
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <WolframSection />
        </div>

        <div style={{
          padding: 16, borderTop: '1px solid rgba(0,229,255,0.15)',
          background: 'rgba(0,20,40,0.4)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={{ ...btnStyle, color: 'var(--text-dim)', borderColor: 'rgba(255,255,255,0.1)' }}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}

// ── Wolfram|Alpha ─────────────────────────────────────────────────────────

interface WolframStatus { configured: boolean; source: 'env' | 'config' | null; preview: string | null }

function WolframSection() {
  const [status, setStatus] = useState<WolframStatus | null>(null);
  const [appId, setAppId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    authFetch(`${API}/api/wolfram/status`)
      .then((r) => r.json())
      .then((d: WolframStatus) => setStatus(d))
      .catch(() => setStatus({ configured: false, source: null, preview: null }));
  }, []);
  useEffect(load, [load]);

  const save = useCallback(async () => {
    if (!appId.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await authFetch(`${API}/api/wolfram/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim() }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; preview?: string };
      if (!res.ok || !d.ok) { setError(d.error ?? 'Wolfram rejected that AppID.'); return; }
      setNotice(`Verified against Wolfram|Alpha and saved (${d.preview}).`);
      setAppId('');
      load();
      window.dispatchEvent(new CustomEvent('jarvis-integrations-changed'));
    } catch {
      setError('Could not reach the Jarvis server.');
    } finally {
      setBusy(false);
    }
  }, [appId, load]);

  const clear = useCallback(async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await authFetch(`${API}/api/wolfram/key`, { method: 'DELETE' });
      setNotice('AppID removed.');
      load();
      window.dispatchEvent(new CustomEvent('jarvis-integrations-changed'));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const fromEnv = status?.source === 'env';

  return (
    <Section
      title="WOLFRAM|ALPHA"
      badge={status === null ? undefined : status.configured ? { text: `ACTIVE · ${status.preview}`, tone: 'green' } : { text: 'NOT SET', tone: 'amber' }}
      hint="Gives Jarvis exact computation: maths, unit conversion, physics, astronomy, finance, nutrition. Free tier is 2,000 calls a month — get an AppID at developer.wolframalpha.com (create an app, any name; the LLM API needs no special product)."
    >
      {fromEnv ? (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Set from the <code style={codeStyle}>WOLFRAM_APP_ID</code> environment variable on the host; change it there.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder={status?.configured ? 'Paste a new AppID to replace the saved one' : 'XXXXXX-XXXXXXXXXX'}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={inputStyle}
          />
          <button
            onClick={() => void save()}
            disabled={busy || !appId.trim()}
            style={{ ...btnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.4)', background: 'rgba(0,229,255,0.08)', opacity: busy || !appId.trim() ? 0.4 : 1, whiteSpace: 'nowrap' }}
          >
            {busy ? 'CHECKING…' : 'TEST & SAVE'}
          </button>
          {status?.configured && (
            <button onClick={() => void clear()} disabled={busy} style={{ ...btnStyle, color: 'var(--accent-red)', borderColor: 'rgba(255,34,68,0.3)' }}>
              REMOVE
            </button>
          )}
        </div>
      )}
      {error && <Banner tone="red">{error}</Banner>}
      {notice && !error && <Banner tone="green">{notice}</Banner>}
    </Section>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────

function Section({ title, hint, badge, children }: {
  title: string; hint?: string;
  badge?: { text: string; tone: 'green' | 'amber' };
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700 }}>{title}</div>
        {badge && (
          <span style={{
            fontSize: 8, letterSpacing: '0.15em', padding: '2px 7px', borderRadius: 2, fontWeight: 700,
            color: badge.tone === 'green' ? 'var(--accent-green)' : 'var(--accent-amber)',
            border: `1px solid ${badge.tone === 'green' ? 'rgba(0,255,157,0.4)' : 'rgba(255,140,0,0.4)'}`,
            background: badge.tone === 'green' ? 'rgba(0,255,157,0.06)' : 'rgba(255,140,0,0.06)',
          }}>
            {badge.text}
          </span>
        )}
      </div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const red = tone === 'red';
  return (
    <div style={{
      fontSize: 10, lineHeight: 1.6,
      color: red ? 'var(--accent-red)' : 'var(--accent-green)',
      background: red ? 'rgba(255,34,68,0.08)' : 'rgba(0,255,157,0.06)',
      border: `1px solid ${red ? 'rgba(255,34,68,0.3)' : 'rgba(0,255,157,0.25)'}`,
      borderRadius: 3, padding: '8px 10px',
    }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  background: 'rgba(0,15,35,0.8)',
  border: '1px solid rgba(0,229,255,0.2)',
  borderRadius: 3,
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 11, fontFamily: 'inherit', outline: 'none', letterSpacing: '0.05em',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid',
  borderRadius: 3,
  padding: '8px 14px',
  fontSize: 10, letterSpacing: '0.2em', fontFamily: 'inherit', fontWeight: 700,
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  color: 'var(--accent-primary)', background: 'rgba(0,229,255,0.08)', padding: '1px 4px', borderRadius: 2,
};
