'use client';
import { useEffect } from 'react';
import { HexGrid } from '@/components/HexGrid';
import { StatusBar } from '@/components/StatusBar';
import { HUDPanel } from '@/components/HUDPanel';
import { JarvisChat } from '@/components/JarvisChat';
import { AgentSwarm } from '@/components/AgentSwarm';
import { TelemetryFeed } from '@/components/TelemetryFeed';
import { useJarvisWS } from '@/hooks/useJarvisWS';
import { useJarvisStore } from '@/lib/store';

export default function Home() {
  useJarvisWS();
  const connected = useJarvisStore((s) => s.connected);
  const agents = useJarvisStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'spawning').length;

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      {/* Animated hex background */}
      <HexGrid />

      {/* Vignette overlay */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,8,0.6) 100%)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* Status bar */}
        <StatusBar />

        {/* Main layout */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 340px', gridTemplateRows: '1fr 1fr', gap: 8, padding: 8, overflow: 'hidden', minHeight: 0 }}>
          {/* Chat panel — spans both rows */}
          <HUDPanel
            title="JARVIS INTERFACE"
            active={connected}
            statusDot={connected ? 'green' : 'red'}
            style={{ gridRow: '1 / 3' } as React.CSSProperties}
            className="h-full"
            headerRight={
              <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                SESSION · DEFAULT
              </span>
            }
          >
            <JarvisChat />
          </HUDPanel>

          {/* Agent swarm */}
          <HUDPanel
            title="AGENT SWARM"
            statusDot={activeAgents > 0 ? 'amber' : 'none'}
            active={activeAgents > 0}
            headerRight={
              <span style={{ fontSize: 9, color: 'var(--accent-amber)', letterSpacing: '0.1em' }}>
                {activeAgents > 0 ? `${activeAgents} ACTIVE` : 'STANDBY'}
              </span>
            }
          >
            <AgentSwarm />
          </HUDPanel>

          {/* Telemetry feed */}
          <HUDPanel
            title="TELEMETRY FEED"
            statusDot="green"
            headerRight={
              <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                LIVE
              </span>
            }
          >
            <TelemetryFeed />
          </HUDPanel>
        </div>
      </div>
    </div>
  );
}
