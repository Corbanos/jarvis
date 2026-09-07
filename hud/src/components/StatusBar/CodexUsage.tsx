'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';
const POLL_MS = 60_000;

interface UsageWindow { usedPercent: number; resetAt: number; resetAfterSeconds: number; label: string }
interface Usage {
  available: boolean;
  reason?: string;
  plan?: string | null;
  limitReached?: boolean;
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  models?: Record<string, { available: boolean; availableAt: number | null }>;
  credits?: { hasCredits: boolean; unlimited: boolean; balance: number | null };
}

/**
 * The ChatGPT/Codex subscription's rolling usage windows, as the Codex CLI's
 * /status shows them. Renders nothing unless a ChatGPT sign-in exists.
 */
export function CodexUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback((force = false) => {
    authFetch(`${API}/api/setup/openai/usage${force ? '?force=1' : ''}`)
      .then((r) => r.json())
      .then((d: Usage) => setUsage(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onRouting = () => load(true);
    const onFocus = () => load();
    window.addEventListener('jarvis-model-routing-changed', onRouting);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(poll); clearInterval(tick);
      window.removeEventListener('jarvis-model-routing-changed', onRouting);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  if (!usage?.available) return null;

  const windows = [usage.primary, usage.secondary].filter((w): w is UsageWindow => !!w);
  const unavailable = Object.entries(usage.models ?? {}).filter(([, m]) => !m.available);
  const title = [
    `ChatGPT ${usage.plan ?? ''} · Codex usage`.trim(),
    ...windows.map((w) => `${w.label}: ${w.usedPercent}% used · resets in ${countdown(w.resetAt - now)}`),
    ...unavailable.map(([slug, m]) => `${slug}: unavailable${m.availableAt ? ` until ${new Date(m.availableAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`),
    usage.credits?.unlimited ? 'credits: unlimited' : usage.credits?.hasCredits ? `credits: ${usage.credits.balance ?? 'available'}` : '',
  ].filter(Boolean).join('\n');

  return (
    <button
      type="button"
      onClick={() => load(true)}
      title={title}
      aria-label={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        border: 0, padding: '4px 6px', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 8, letterSpacing: '0.25em', color: usage.limitReached ? 'var(--accent-red)' : 'var(--text-dim)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {usage.limitReached ? 'CODEX LIMIT' : 'CODEX'}
      </span>
      {windows.map((w) => <WindowBar key={w.label} w={w} now={now} />)}
    </button>
  );
}

function WindowBar({ w, now }: { w: UsageWindow; now: number }) {
  const color = w.usedPercent >= 100 ? 'var(--accent-red)' : w.usedPercent >= 75 ? 'var(--accent-amber)' : 'var(--accent-green)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 74 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, letterSpacing: '0.15em', lineHeight: 1 }}>
        <span style={{ color: 'var(--text-dim)' }}>{w.label}</span>
        <span style={{ color, fontWeight: 700 }}>{w.usedPercent}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${w.usedPercent}%`, height: '100%', background: color, boxShadow: `0 0 6px ${color}`, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.1em', lineHeight: 1, whiteSpace: 'nowrap' }}>
        {w.usedPercent >= 100 ? `resets ${countdown(w.resetAt - now)}` : `↻ ${countdown(w.resetAt - now)}`}
      </div>
    </div>
  );
}

/** "1h 46m", "3d 4h", "12m", "now". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'now';
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
