'use client';
import { useEffect, useState } from 'react';
import { useJarvisWS } from '@/hooks/useJarvisWS';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useJarvisStore } from '@/lib/store';
import { useAudioLevel } from '@/lib/audio-level';
import { HexGrid } from '@/components/HexGrid';
import { StatusBar } from '@/components/StatusBar';
import { HUDPanel } from '@/components/HUDPanel';
import { JarvisChat } from '@/components/JarvisChat';
import { AgentSwarm } from '@/components/AgentSwarm';
import { TelemetryFeed } from '@/components/TelemetryFeed';
import { ArcReactor } from '@/components/ArcReactor';
import { RingGauge } from '@/components/RingGauge';
import { SchedulerPanel } from '@/components/SchedulerPanel';
import { SetupScreen } from '@/components/SetupScreen';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';
type RightTab = 'agents' | 'scheduler' | 'telemetry';
type AppState = 'checking' | 'setup' | 'ready';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('checking');

  useEffect(() => {
    fetch(`${API}/api/setup/status`)
      .then((r) => r.json())
      .then((data: { configured: boolean; valid: boolean }) => {
        setAppState(data.configured && data.valid ? 'ready' : 'setup');
      })
      .catch(() => setAppState('setup'));
  }, []);

  if (appState === 'checking') return <BootScreen />;
  if (appState === 'setup') return <SetupScreen onComplete={() => setAppState('ready')} />;
  return <Dashboard />;
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

function Dashboard() {
  useJarvisWS();
  useChatHistory('default');
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
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.7) 100%)' }} />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,229,255,0.012) 0px, transparent 1px, transparent 28px)' }} />

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <StatusBar />

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '230px 1fr 250px', gap: 6, padding: 6, minHeight: 0 }}>

          {/* LEFT: System gauges only — reactor moved to center */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <HUDPanel title="SYSTEMS" headerRight="STARK OS v4">
              <div style={{ padding: '14px 8px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <RingGauge label="CPU" value={stats.cpu} size={86} />
                  <RingGauge label="RAM" value={stats.ram} size={86} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <RingGauge label="DISK" value={stats.disk} size={70} color="#ff8c00" />
                  <RingGauge label="GPU" value={stats.gpu} size={70} color="#00ff9d" />
                </div>
                <NetworkDisplay upload={stats.net} download={stats.net * 2.3} />
              </div>
            </HUDPanel>

            <HUDPanel title="POWER" accentColor="#ff8c00">
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <PowerLine label="ARC REACTOR" value={100} color="#00e5ff" />
                <PowerLine label="REPULSORS" value={87} color="#00e5ff" />
                <PowerLine label="SUIT POWER" value={94} color="#ff8c00" />
                <PowerLine label="SHIELDS" value={71} color="#00ff9d" />
              </div>
            </HUDPanel>
          </div>

          {/* CENTER: Reactor on top, chat below */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
            <ReactorStage connected={connected} />
            <HUDPanel
              title="JARVIS INTERFACE"
              active={connected}
              statusDot={connected ? 'green' : 'red'}
              style={{ flex: 1, minHeight: 0 }}
              headerRight={
                <span style={{ color: connected ? 'var(--accent-green)' : 'var(--accent-red)', letterSpacing: '0.15em', fontWeight: 700 }}>
                  {connected ? '■ ONLINE' : '■ OFFLINE'}
                </span>
              }
            >
              <JarvisChat />
            </HUDPanel>
          </div>

          {/* RIGHT: tabs */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,229,255,0.15)', background: 'rgba(0,4,12,0.95)', flexShrink: 0 }}>
              {tabs.map((tab) => (
                <button key={tab.key} onClick={() => setRightTab(tab.key)} style={{
                  flex: 1, padding: '7px 4px',
                  background: rightTab === tab.key ? 'rgba(0,229,255,0.08)' : 'transparent',
                  border: 'none',
                  borderBottom: rightTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  color: rightTab === tab.key ? 'var(--accent-primary)' : 'var(--text-dim)',
                  fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.2s', position: 'relative',
                }}>
                  {tab.label}
                  {tab.badge ? (
                    <span style={{ position: 'absolute', top: 3, right: 6, background: 'var(--accent-amber)', color: '#000', borderRadius: '50%', width: 12, height: 12, fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{tab.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {rightTab === 'agents' && (
                <HUDPanel title="AGENT NETWORK" statusDot={activeAgents > 0 ? 'amber' : 'none'} active={activeAgents > 0}
                  accentColor={activeAgents > 0 ? '#ff8c00' : '#00e5ff'} style={{ height: '100%' }}
                  headerRight={activeAgents > 0 ? `${activeAgents} ACTIVE` : 'STANDBY'}>
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

// ─── Reactor stage: centered, audio-reactive label ────────────────────────────

function ReactorStage({ connected }: { connected: boolean }) {
  const source = useAudioLevel((s) => s.source);
  const level = useAudioLevel((s) => s.level);

  const sourceLabel = source === 'jarvis' ? 'JARVIS SPEAKING' : source === 'user' ? 'USER SPEAKING' : connected ? 'STANDING BY' : 'OFFLINE';
  const sourceColor = source === 'jarvis' ? 'var(--accent-bright)' : source === 'user' ? 'var(--accent-amber)' : connected ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div style={{
      height: 320,
      flexShrink: 0,
      position: 'relative',
      background: 'radial-gradient(ellipse at center, rgba(0,30,60,0.4) 0%, rgba(0,4,12,0.7) 60%, transparent 100%)',
      border: '1px solid rgba(0,229,255,0.08)',
      borderRadius: 4,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Top-left ID tag */}
      <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.25em' }}>
        ◇ ARC REACTOR · MK-42
      </div>
      {/* Top-right power */}
      <div style={{ position: 'absolute', top: 8, right: 12, fontSize: 8, letterSpacing: '0.25em' }}>
        <span style={{ color: 'var(--text-dim)' }}>OUTPUT </span>
        <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>3.07 GJ/s</span>
      </div>

      {/* Bottom audio source label */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 9, letterSpacing: '0.3em', color: sourceColor,
        fontWeight: 700,
        transition: 'color 0.2s',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: sourceColor,
          boxShadow: `0 0 ${6 + level * 16}px ${sourceColor}`,
          transition: 'box-shadow 0.1s',
        }} />
        {sourceLabel}
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: sourceColor,
          boxShadow: `0 0 ${6 + level * 16}px ${sourceColor}`,
          transition: 'box-shadow 0.1s',
        }} />
      </div>

      {/* Side audio level bars */}
      <SideMeter side="left" level={level} color={sourceColor} />
      <SideMeter side="right" level={level} color={sourceColor} />

      {/* The reactor itself */}
      <ArcReactor size={290} />
    </div>
  );
}

function SideMeter({ side, level, color }: { side: 'left' | 'right'; level: number; color: string }) {
  const bars = 12;
  return (
    <div style={{
      position: 'absolute',
      top: '50%', transform: 'translateY(-50%)',
      [side]: 16,
      display: 'flex', flexDirection: 'column', gap: 3,
      height: 200,
      justifyContent: 'center',
    }}>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (bars - i) / bars; // top bar = highest
        const active = level >= threshold * 0.9;
        return (
          <div key={i} style={{
            width: 14, height: 5,
            background: active ? color : 'rgba(0,229,255,0.06)',
            borderRadius: 1,
            boxShadow: active ? `0 0 6px ${color}` : 'none',
            transition: 'background 0.05s, box-shadow 0.05s',
          }} />
        );
      })}
    </div>
  );
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function rnd(range: number) { return (Math.random() - 0.5) * range; }

function PowerLine({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, letterSpacing: '0.1em' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color }}>{value}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 6px ${color}`, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function NetworkDisplay({ upload, download }: { upload: number; download: number }) {
  return (
    <div style={{ width: '100%', padding: '0 8px' }}>
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
