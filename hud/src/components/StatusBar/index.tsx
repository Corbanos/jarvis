'use client';
import { useEffect, useState } from 'react';
import { useJarvisStore } from '@/lib/store';

export function StatusBar() {
  const connected = useJarvisStore((s) => s.connected);
  const agents = useJarvisStore((s) => s.agents);
  const [uptime, setUptime] = useState(0);
  const [time, setTime] = useState('');

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setUptime(Math.floor((Date.now() - start) / 1000));
      setTime(new Date().toLocaleTimeString('en-US', { hour12: false }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'spawning').length;
  const fmt = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div
      style={{
        height: 44,
        background: 'rgba(0,8,20,0.95)',
        borderBottom: '1px solid rgba(0,212,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
      }}
    >
      {/* Left: JARVIS branding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.25em',
            color: 'var(--accent-primary)',
          }}
          className="text-flicker"
        >
          J.A.R.V.I.S.
        </span>
        <Separator />
        <StatusPill online={connected} />
        <Separator />
        <StatItem label="UPTIME" value={fmt(uptime)} />
        <Separator />
        <StatItem label="AGENTS" value={String(activeAgents)} highlight={activeAgents > 0} />
      </div>

      {/* Center: system bars */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <MiniBar label="CPU" value={Math.random() * 30 + 10} />
        <MiniBar label="MEM" value={Math.random() * 20 + 40} color="var(--accent-secondary)" />
        <MiniBar label="NET" value={Math.random() * 60} color="var(--accent-green)" />
      </div>

      {/* Right: clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.1em' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
        <span style={{ fontSize: 13, color: 'var(--accent-primary)', letterSpacing: '0.15em', fontWeight: 600 }}>
          {time}
        </span>
      </div>
    </div>
  );
}

function Separator() {
  return <div style={{ width: 1, height: 16, background: 'rgba(0,212,255,0.15)' }} />;
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: online ? 'var(--accent-green)' : 'var(--accent-red)',
          boxShadow: online ? '0 0 8px var(--accent-green)' : '0 0 8px var(--accent-red)',
          animation: online ? 'thinking-pulse 2s infinite' : 'none',
        }}
      />
      <span style={{ fontSize: 10, letterSpacing: '0.15em', color: online ? 'var(--accent-green)' : 'var(--accent-red)' }}>
        {online ? 'ONLINE' : 'CONNECTING'}
      </span>
    </div>
  );
}

function StatItem({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.15em' }}>{label}</span>
      <span style={{ fontSize: 11, color: highlight ? 'var(--accent-amber)' : 'var(--text-secondary)', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function MiniBar({ label, value, color = 'var(--accent-primary)' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', width: 26 }}>{label}</span>
      <div style={{ width: 48, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 1s ease' }} />
      </div>
      <span style={{ fontSize: 9, color, width: 28 }}>{value.toFixed(0)}%</span>
    </div>
  );
}
