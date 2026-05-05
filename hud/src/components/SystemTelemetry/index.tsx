'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { useJarvisStore } from '@/lib/store';

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

  const currentModel = useJarvisStore((s) => s.currentModel);
  const availableModels = useJarvisStore((s) => s.availableModels);
  const setCurrentModel = useJarvisStore((s) => s.setCurrentModel);

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

    authFetch(`${API}/api/model`)
      .then((r) => r.json())
      .then((d: { current: string }) => { if (d.current) setCurrentModel(d.current); })
      .catch(() => { /* ignore */ });

    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [setCurrentModel]);

  const uptimeStr = health.uptime ? formatDuration(health.uptime) : '—';

  async function changeModel(m: string) {
    try {
      const res = await authFetch(`${API}/api/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m }),
      });
      if (res.ok) setCurrentModel(m);
    } catch { /* ignore */ }
  }

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Stat label="API LATENCY" value={`${latency}`} unit="ms" color={latency < 50 ? 'var(--accent-green)' : latency < 200 ? 'var(--accent-amber)' : 'var(--accent-red)'} />
      <Stat label="UPTIME" value={uptimeStr} />
      <Stat label="ACTIVE AGENTS" value={String(health.agents ?? 0)} color={(health.agents ?? 0) > 0 ? 'var(--accent-amber)' : undefined} />
      <Stat label="WS CLIENTS" value={String(health.wsClients ?? 0)} />

      <Divider />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.15em' }}>CLAUDE MODEL</span>
        <select
          value={currentModel}
          onChange={(e) => changeModel(e.target.value)}
          style={{
            background: 'rgba(0,229,255,0.05)',
            border: '1px solid rgba(0,229,255,0.3)',
            borderRadius: 3,
            color: 'var(--accent-primary)',
            fontSize: 10,
            padding: '5px 8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.04em',
            width: '100%',
          }}
        >
          {availableModels.map((m) => (
            <option key={m} value={m} style={{ background: '#0a1428', color: '#00e5ff' }}>
              {prettyModel(m)}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.05em', marginTop: 2 }}>
          Used by Jarvis + new agents.
        </div>
      </div>

      <Divider />

      <Stat label="VTT (whisper)" value={voice.whisperAvailable ? 'READY' : 'OFFLINE'} color={voice.whisperAvailable ? 'var(--accent-green)' : 'var(--accent-red)'} />
      <Stat label="TTS engine" value={voice.method ?? '—'} color={voice.kokoroAvailable ? 'var(--accent-green)' : 'var(--accent-amber)'} />
      <Stat label="VOICE" value={voice.voice ?? '—'} />
    </div>
  );
}

function prettyModel(m: string): string {
  // Map api id → display name. Keep these in sync with AVAILABLE_MODELS.
  if (m === 'claude-opus-4-7')              return 'Opus 4.7';
  if (m === 'claude-sonnet-4-6')            return 'Sonnet 4.6';
  if (m === 'claude-opus-4-6')              return 'Opus 4.6';
  if (m === 'claude-opus-4-5-20251101')     return 'Opus 4.5';
  if (m === 'claude-haiku-4-5-20251001')    return 'Haiku 4.5';
  if (m === 'claude-sonnet-4-5-20250929')   return 'Sonnet 4.5';
  if (m.includes('opus-4-7'))   return 'Opus 4.7';
  if (m.includes('sonnet-4-6')) return 'Sonnet 4.6';
  if (m.includes('opus-4-6'))   return 'Opus 4.6';
  if (m.includes('opus-4-5'))   return 'Opus 4.5';
  if (m.includes('haiku-4-5'))  return 'Haiku 4.5';
  if (m.includes('sonnet-4-5')) return 'Sonnet 4.5';
  if (m.includes('sonnet-4'))   return 'Sonnet 4';
  if (m.includes('opus-4'))     return 'Opus 4';
  return m;
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
