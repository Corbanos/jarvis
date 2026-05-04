'use client';
import { useEffect, useState } from 'react';
import { useJarvisWS } from '@/hooks/useJarvisWS';
import { useJarvisStore } from '@/lib/store';
import { HexGrid } from '@/components/HexGrid';
import { StatusBar } from '@/components/StatusBar';
import { HUDPanel } from '@/components/HUDPanel';
import { JarvisChat } from '@/components/JarvisChat';
import { AgentSwarm } from '@/components/AgentSwarm';
import { TelemetryFeed } from '@/components/TelemetryFeed';
import { ArcReactor } from '@/components/ArcReactor';
import { RingGauge } from '@/components/RingGauge';
import { SchedulerPanel } from '@/components/SchedulerPanel';

type RightTab = 'agents' | 'scheduler' | 'telemetry';

export default function Home() {
  useJarvisWS();
  const connected = useJarvisStore((s) => s.connected);
  const agents = useJarvisStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'spawning').length;
  const [rightTab, setRightTab] = useState<RightTab>('agents');
  const [stats, setStats] = useState({ cpu: 18, ram: 52, disk: 64, gpu: 31, temp: 54, net: 12 });

  useEffect(() => {
    const t = setInterval(() => {
      setStats((s) => ({
        cpu: clamp(s.cpu + rnd(8), 5, 95),
        ram: clamp(s.ram + rnd(3), 30, 85),
        disk: s.disk,
        gpu: clamp(s.gpu + rnd(6), 5, 90),
        temp: clamp(s.temp + rnd(2), 40, 80),
        net: clamp(s.net + rnd(15), 2, 80),
      }));
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const tabs: { key: RightTab; label: string; badge?: number }[] = [
    { key: 'agents', label: 'AGENTS', badge: activeAgents || undefined },
    { key: 'scheduler', label: 'SCHEDULE' },
    { key: 'telemetry', label: 'TELEMETRY' },
  ];

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden', position: 'relative' }}>

      <HexGrid />

      {/* Vignette */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.7) 100%)' }} />

      {/* Blueprint lines */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,229,255,0.012) 0px, transparent 1px, transparent 28px)' }} />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <StatusBar />

        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: '210px 1fr 250px',
          gap: 6, padding: 6, minHeight: 0,
        }}>

          {/* LEFT: Core status + system */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

            {/* Arc reactor core */}
            <HUDPanel title="CORE STATUS" statusDot={connected ? 'green' : 'red'} active={connected}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 8px' }}>
                <ArcReactor />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 160 }}>
                  <MiniStat label="CPU" value={`${stats.cpu.toFixed(0)}%`} />
                  <MiniStat label="RAM" value={`${stats.ram.toFixed(0)}%`} />
                  <MiniStat label="GPU" value={`${stats.gpu.toFixed(0)}%`} />
                  <MiniStat label="TEMP" value={`${stats.temp.toFixed(0)}°C`} color="var(--accent-amber)" />
                </div>
                <PowerLine label="POWER LEVEL" value={100} />
              </div>
            </HUDPanel>

            {/* System gauges */}
            <HUDPanel title="SYSTEMS" headerRight="STARK OS v4">
              <div style={{ padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <RingGauge label="CPU" value={stats.cpu} size={76} />
                  <RingGauge label="RAM" value={stats.ram} size={76} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <RingGauge label="DISK" value={stats.disk} size={60} color="#ff8c00" />
                  <RingGauge label="GPU" value={stats.gpu} size={60} color="#00ff9d" />
                </div>
                <div style={{ width: '100%', padding: '0 8px' }}>
                  <NetworkDisplay upload={stats.net} download={stats.net * 2.3} />
                </div>
              </div>
            </HUDPanel>

          </div>

          {/* CENTER: JARVIS chat */}
          <HUDPanel
            title="JARVIS INTERFACE — v2.0"
            active={connected}
            statusDot={connected ? 'green' : 'red'}
            headerRight={
              <span style={{ color: connected ? 'var(--accent-green)' : 'var(--accent-red)', letterSpacing: '0.15em', fontWeight: 700 }}>
                {connected ? '■ ONLINE' : '■ OFFLINE'}
              </span>
            }
          >
            <JarvisChat />
          </HUDPanel>

          {/* RIGHT: Tabbed panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex',
              borderBottom: '1px solid rgba(0,229,255,0.15)',
              background: 'rgba(0,4,12,0.95)',
            }}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setRightTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: '7px 4px',
                    background: rightTab === tab.key ? 'rgba(0,229,255,0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: rightTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
                    color: rightTab === tab.key ? 'var(--accent-primary)' : 'var(--text-dim)',
                    fontSize: 8,
                    letterSpacing: '0.15em',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.2s',
                    position: 'relative',
                  }}
                >
                  {tab.label}
                  {tab.badge ? (
                    <span style={{
                      position: 'absolute', top: 3, right: 6,
                      background: 'var(--accent-amber)', color: '#000',
                      borderRadius: '50%', width: 12, height: 12,
                      fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                    }}>{tab.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {rightTab === 'agents' && (
                <HUDPanel
                  title="AGENT NETWORK"
                  statusDot={activeAgents > 0 ? 'amber' : 'none'}
                  active={activeAgents > 0}
                  accentColor={activeAgents > 0 ? '#ff8c00' : '#00e5ff'}
                  style={{ height: '100%' }}
                  headerRight={activeAgents > 0 ? `${activeAgents} ACTIVE` : 'STANDBY'}
                >
                  <AgentSwarm />
                </HUDPanel>
              )}
              {rightTab === 'scheduler' && (
                <HUDPanel title="SCHEDULER" statusDot="green" style={{ height: '100%' }} headerRight="CRONOS v1">
                  <SchedulerPanel />
                </HUDPanel>
              )}
              {rightTab === 'telemetry' && (
                <HUDPanel title="TELEMETRY FEED" statusDot="green" style={{ height: '100%' }} headerRight="LIVE">
                  <TelemetryFeed />
                </HUDPanel>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Utility components ────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function rnd(range: number) {
  return (Math.random() - 0.5) * range;
}

function MiniStat({ label, value, color = 'var(--accent-primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.2em' }}>{label}</div>
      <div style={{ fontSize: 12, color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function PowerLine({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ width: '100%', padding: '0 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, letterSpacing: '0.1em', marginBottom: 3 }}>
        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{value}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(0,229,255,0.08)', borderRadius: 2 }}>
        <div style={{
          width: `${value}%`, height: '100%',
          background: 'linear-gradient(90deg, var(--accent-secondary), var(--accent-bright))',
          boxShadow: '0 0 8px var(--accent-primary)',
          borderRadius: 2, transition: 'width 1s ease',
        }} />
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 3, textAlign: 'center' }}>
        Currently holding steady.
      </div>
    </div>
  );
}

function NetworkDisplay({ upload, download }: { upload: number; download: number }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em', marginBottom: 5, textAlign: 'center' }}>NETWORK I/O</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700 }}>↑ {upload.toFixed(1)}</div>
          <div style={{ fontSize: 7, color: 'var(--text-dim)' }}>MB/s UP</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--accent-green)', fontWeight: 700 }}>↓ {download.toFixed(1)}</div>
          <div style={{ fontSize: 7, color: 'var(--text-dim)' }}>MB/s DN</div>
        </div>
      </div>
    </div>
  );
}
