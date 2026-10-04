'use client';
import { useEffect, useState } from 'react';
import { useJarvisStore } from '@/lib/store';
import { requestPreciseLocation, secureUpgradeUrl, usePreciseLocation } from '@/lib/geolocation';
import { CodexUsage } from './CodexUsage';

export function StatusBar() {
  const connected = useJarvisStore((s) => s.connected);
  const agents = useJarvisStore((s) => s.agents);
  const [uptime, setUptime] = useState(0);
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setUptime(Math.floor((Date.now() - start) / 1000));
      setTime(new Date().toLocaleTimeString('en-US', { hour12: false }));
      setDate(new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'spawning').length;

  return (
    <div style={{
      height: 56,
      background: 'rgba(0,0,0,0.97)',
      borderBottom: '1px solid rgba(0,229,255,0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Scan line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(0,229,255,0.4) 50%, transparent 100%)',
        animation: 'scanline 6s linear infinite', pointerEvents: 'none',
      }} />

      {/* Left section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.3em', color: 'var(--accent-bright)', textShadow: 'var(--glow-strong)' }} className="text-flicker">
            J.A.R.V.I.S.
          </span>
          <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-dim)' }}>
            STARK INDUSTRIES · ADVANCED INTERFACE SYSTEM
          </span>
        </div>

        <div style={{ width: 1, height: 32, background: 'rgba(0,229,255,0.15)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? 'var(--accent-green)' : 'var(--accent-red)',
            boxShadow: connected ? '0 0 10px var(--accent-green)' : '0 0 10px var(--accent-red)',
            animation: 'pulse-glow 2s infinite',
          }} />
          <span style={{ fontSize: 10, letterSpacing: '0.2em', color: connected ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
            {connected ? 'SYSTEMS ONLINE' : 'RECONNECTING'}
          </span>
        </div>

        <div style={{ width: 1, height: 32, background: 'rgba(0,229,255,0.15)' }} />

        <PreciseLocationControl />
        <CodexUsage />
        <div style={{ width: 1, height: 32, background: 'rgba(0,229,255,0.15)' }} />

        <DataChip label="THIS TAB" value={fmt(uptime)} />
        <DataChip label="AGENTS" value={String(activeAgents)} color={activeAgents > 0 ? 'var(--accent-amber)' : undefined} />

      </div>

      {/* Browsers cannot report system CPU/RAM utilisation or battery reliably.
          Do not replace missing device telemetry with random or host statistics. */}
      {/* Right: date/time */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent-bright)', textShadow: 'var(--glow-soft)', lineHeight: 1 }}>
          {time}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)', letterSpacing: '0.15em' }}>{date}</span>
      </div>
    </div>
  );
}

function PreciseLocationControl() {
  const status = usePreciseLocation((state) => state.status);
  const accuracyM = usePreciseLocation((state) => state.accuracyM);
  const message = usePreciseLocation((state) => state.message);
  // Resolved after mount: window doesn't exist during SSR, and computing it
  // during render would make the server and client disagree on the label.
  const [needsHttps, setNeedsHttps] = useState(false);
  useEffect(() => { setNeedsHttps(secureUpgradeUrl() !== null); }, []);

  const active = status === 'active';
  const color = active
    ? (accuracyM !== null && accuracyM <= 100 ? 'var(--accent-green)' : 'var(--accent-amber)')
    : status === 'denied' || status === 'unavailable' || status === 'error'
      ? 'var(--accent-red)'
      : 'var(--accent-amber)';
  const value = active
    ? `GPS ±${accuracyM ?? '?'}M`
    : status === 'requesting'
      ? 'LOCATING...'
      : status === 'denied'
        ? 'LOCATION BLOCKED'
        : status === 'unavailable'
          ? (needsHttps ? 'GPS NEEDS HTTPS' : 'GPS UNAVAILABLE')
          : 'ENABLE PRECISE';

  return (
    <button
      type="button"
      onClick={requestPreciseLocation}
      title={message}
      aria-label={`${value}. ${message}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        border: 0, padding: '4px 6px', background: 'transparent', cursor: 'pointer',
        fontFamily: 'inherit', minWidth: 112,
      }}
    >
      <span style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.2em' }}>THIS DEVICE GPS</span>
      <span style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '0.08em', textShadow: active ? `0 0 8px ${color}` : undefined }}>
        {value}
      </span>
    </button>
  );
}

function DataChip({ label, value, color = 'var(--accent-primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <span style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.2em' }}>{label}</span>
      <span style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: '0.1em' }}>{value}</span>
    </div>
  );
}
