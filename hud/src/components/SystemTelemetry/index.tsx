'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';
import { useJarvisStore } from '@/lib/store';
import { formatModelName as formatModelLabel } from '@/lib/model-names';

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
  const setAvailableModels = useJarvisStore((s) => s.setAvailableModels);

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

    const loadModels = () => {
      authFetch(`${API}/api/model`)
        .then((r) => r.json())
        .then((d: { current: string; available?: string[] }) => {
          if (d.current) setCurrentModel(d.current);
          if (d.available?.length) setAvailableModels(d.available);
        })
        .catch(() => { /* ignore */ });
    };
    loadModels();
    window.addEventListener('jarvis-model-routing-changed', loadModels);

    tick();
    const t = setInterval(tick, 4000);
    return () => {
      clearInterval(t);
      window.removeEventListener('jarvis-model-routing-changed', loadModels);
    };
  }, [setCurrentModel, setAvailableModels]);

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
      <Stat label="DEVICE → SERVER RTT" value={`${latency}`} unit="ms" color={latency < 50 ? 'var(--accent-green)' : latency < 200 ? 'var(--accent-amber)' : 'var(--accent-red)'} />
      <Stat label="SERVER UPTIME" value={uptimeStr} />
      <Stat label="SERVER AGENTS" value={String(health.agents ?? 0)} color={(health.agents ?? 0) > 0 ? 'var(--accent-amber)' : undefined} />
      <Stat label="SERVER CONNECTIONS" value={String(health.wsClients ?? 0)} />

      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>GPS, clock and tab uptime describe this device. CPU/RAM and battery usage are not exposed by this browser. Voice audio plays here only for requests sent here.</div>
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

      <Stat label="SERVER VTT" value={voice.whisperAvailable ? 'READY' : 'OFFLINE'} color={voice.whisperAvailable ? 'var(--accent-green)' : 'var(--accent-red)'} />
      <Stat label="SERVER TTS ENGINE" value={voice.method ?? '—'} color={voice.kokoroAvailable ? 'var(--accent-green)' : 'var(--accent-amber)'} />
      <Stat label="VOICE" value={voice.voice ?? '—'} />
    </div>
  );
}

function prettyModel(m: string): string {
  return formatModelLabel(m);
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
