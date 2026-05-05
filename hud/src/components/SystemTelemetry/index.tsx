'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface SystemStats {
  uptime?: number;
  agents?: number;
  wsClients?: number;
  status?: string;
}

interface VoiceStatus {
  whisperAvailable?: boolean;
  voice?: string;
  method?: string;
  kokoroAvailable?: boolean;
}

export function SystemTelemetry() {
  const [health, setHealth] = useState<SystemStats>({});
  const [voice, setVoice] = useState<VoiceStatus>({});
  const [latency, setLatency] = useState<number>(0);

  useEffect(() => {
    const tick = async () => {
      const t0 = performance.now();
      try {
        const res = await authFetch(`${API}/api/health`);
        setLatency(Math.round(performance.now() - t0));
        const data = await res.json() as SystemStats;
        setHealth(data);
      } catch { /* ignore */ }
    };

    authFetch(`${API}/api/voice/status`)
      .then((r) => r.json())
      .then((d: VoiceStatus) => setVoice(d))
      .catch(() => { /* ignore */ });

    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, []);

  const uptimeStr = health.uptime
    ? formatDuration(health.uptime)
    : '—';

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Stat label="API LATENCY" value={`${latency}`} unit="ms" color={latency < 50 ? 'var(--accent-green)' : latency < 200 ? 'var(--accent-amber)' : 'var(--accent-red)'} />
      <Stat label="UPTIME" value={uptimeStr} />
      <Stat label="ACTIVE AGENTS" value={String(health.agents ?? 0)} color={(health.agents ?? 0) > 0 ? 'var(--accent-amber)' : undefined} />
      <Stat label="WS CLIENTS" value={String(health.wsClients ?? 0)} />
      <Divider />
      <Stat label="VTT (whisper)" value={voice.whisperAvailable ? 'READY' : 'OFFLINE'} color={voice.whisperAvailable ? 'var(--accent-green)' : 'var(--accent-red)'} />
      <Stat label="TTS engine" value={voice.method ?? '—'} color={voice.kokoroAvailable ? 'var(--accent-green)' : 'var(--accent-amber)'} />
      <Stat label="VOICE" value={voice.voice ?? '—'} />
    </div>
  );
}

function Stat({ label, value, unit, color = 'var(--accent-bright)' }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 9 }}>
      <span style={{ color: 'var(--text-dim)', letterSpacing: '0.15em' }}>{label}</span>
      <span style={{ color, fontWeight: 700, letterSpacing: '0.05em' }}>
        {value}
        {unit && <span style={{ fontSize: 8, marginLeft: 3, color: 'var(--text-secondary)', fontWeight: 400 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(0,229,255,0.1)', margin: '4px 0' }} />;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
