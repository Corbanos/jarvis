'use client';
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
import { useEffect, useState } from 'react';

export default function Home() {
  useJarvisWS();
  const connected = useJarvisStore((s) => s.connected);
  const agents = useJarvisStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'spawning').length;
  const [stats, setStats] = useState({ cpu: 18, ram: 52, disk: 64, gpu: 31, temp: 54, net: 12 });

  useEffect(() => {
    const t = setInterval(() => {
      setStats((s) => ({
        cpu: Math.max(5, Math.min(95, s.cpu + (Math.random() - 0.5) * 8)),
        ram: Math.max(30, Math.min(85, s.ram + (Math.random() - 0.5) * 3)),
        disk: s.disk,
        gpu: Math.max(5, Math.min(90, s.gpu + (Math.random() - 0.5) * 6)),
        temp: Math.max(40, Math.min(80, s.temp + (Math.random() - 0.5) * 2)),
        net: Math.max(2, Math.min(80, s.net + (Math.random() - 0.5) * 15)),
      }));
    }, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden', position: 'relative' }}>

      {/* Hex background */}
      <HexGrid />

      {/* Radial vignette */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.65) 100%)',
      }} />

      {/* Blueprint horizontal lines */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,229,255,0.015) 0px, transparent 1px, transparent 32px)',
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100vh' }}>

        <StatusBar />

        {/* Main grid */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: '200px 1fr 220px',
          gridTemplateRows: '1fr 160px',
          gap: 6,
          padding: 6,
          minHeight: 0,
        }}>

          {/* Left column: Arc Reactor + Ring gauges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Arc reactor panel */}
            <HUDPanel title="CORE STATUS" statusDot={connected ? 'green' : 'red'} active={connected}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 12 }}>
                <ArcReactor />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <MiniStat label="CPU" value={`${stats.cpu.toFixed(0)}%`} />
                  <MiniStat label="RAM" value={`${stats.ram.toFixed(0)}%`} />
                  <MiniStat label="GPU" value={`${stats.gpu.toFixed(0)}%`} />
                  <MiniStat label="TEMP" value={`${stats.temp.toFixed(0)}°C`} color="var(--accent-amber)" />
                </div>
              </div>
            </HUDPanel>

            {/* System gauges */}
            <HUDPanel title="SYSTEM" headerRight="STARK OS v4.2">
              <div style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <RingGauge label="CPU" value={stats.cpu} size={72} />
                  <RingGauge label="RAM" value={stats.ram} size={72} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <RingGauge label="DISK" value={stats.disk} size={60} color="#ff8c00" />
                  <RingGauge label="GPU" value={stats.gpu} size={60} color="#00ff9d" />
                </div>
                <NetworkBar upload={stats.net} download={stats.net * 2.3} />
              </div>
            </HUDPanel>
          </div>

          {/* Center: Main chat — spans row 1 */}
          <HUDPanel
            title="JARVIS INTERFACE"
            active={connected}
            statusDot={connected ? 'green' : 'red'}
            style={{ gridRow: '1 / 3' }}
            headerRight={
              <span style={{ color: connected ? 'var(--accent-green)' : 'var(--accent-red)', letterSpacing: '0.15em' }}>
                {connected ? '● CONNECTED' : '● OFFLINE'}
              </span>
            }
          >
            <JarvisChat />
          </HUDPanel>

          {/* Right: Agent swarm */}
          <HUDPanel
            title="AGENT NETWORK"
            statusDot={activeAgents > 0 ? 'amber' : 'none'}
            active={activeAgents > 0}
            accentColor={activeAgents > 0 ? '#ff8c00' : '#00e5ff'}
            headerRight={activeAgents > 0 ? `${activeAgents} ACTIVE` : 'STANDBY'}
          >
            <AgentSwarm />
          </HUDPanel>

          {/* Bottom left: power level bar (Stark style) */}
          <HUDPanel title="POWER SYSTEMS" accentColor="#ff8c00">
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <PowerBar label="ARC REACTOR" value={100} color="#00e5ff" />
              <PowerBar label="REPULSORS" value={87} color="#00e5ff" />
              <PowerBar label="SUIT POWER" value={94} color="#ff8c00" />
              <PowerBar label="SHIELDS" value={71} color="#00ff9d" />
              <div style={{ marginTop: 4, fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em' }}>
                Currently power level at <span style={{ color: 'var(--accent-bright)' }}>100</span> percent and holding steady.
              </div>
            </div>
          </HUDPanel>

          {/* Bottom right: telemetry */}
          <HUDPanel title="TELEMETRY FEED" statusDot="green" headerRight="LIVE">
            <TelemetryFeed />
          </HUDPanel>

        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = 'var(--accent-primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.2em' }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: '0.05em' }}>{value}</div>
    </div>
  );
}

function PowerBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, letterSpacing: '0.1em' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color }}>{value}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`, height: '100%', borderRadius: 2,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          boxShadow: `0 0 6px ${color}`,
          transition: 'width 1s ease',
        }} />
      </div>
    </div>
  );
}

function NetworkBar({ upload, download }: { upload: number; download: number }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em', marginBottom: 4, textAlign: 'center' }}>NETWORK</div>
      <div style={{ display: 'flex', gap: 8, fontSize: 9 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>↑ {upload.toFixed(1)}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 7 }}>MB/s UP</div>
        </div>
        <div style={{ width: 1, background: 'rgba(0,229,255,0.15)' }} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ color: 'var(--accent-green)', fontWeight: 700 }}>↓ {download.toFixed(1)}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 7 }}>MB/s DN</div>
        </div>
      </div>
    </div>
  );
}
