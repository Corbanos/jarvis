'use client';
import { useState } from 'react';
import { useJarvisStore, type AgentRecord } from '@/lib/store';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function AgentSwarm() {
  const agents = useJarvisStore((s) => s.agents);
  const sortedAgents = [...agents].reverse(); // newest first

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {agents.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em', textAlign: 'center', marginTop: 30 }}>
          NO AGENTS DEPLOYED
        </div>
      )}
      {sortedAgents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  const [expanded, setExpanded] = useState(agent.status === 'running');

  const isRunning = agent.status === 'running' || agent.status === 'spawning';
  const isComplete = agent.status === 'complete';
  const isFailed = agent.status === 'failed';

  const accent = isRunning ? '#ff8c00' : isComplete ? '#00ff9d' : isFailed ? '#ff3b3b' : '#00e5ff';

  const elapsed = agent.completedAt
    ? `${((agent.completedAt - agent.startedAt) / 1000).toFixed(1)}s`
    : `${((Date.now() - agent.startedAt) / 1000).toFixed(0)}s`;

  return (
    <div style={{
      background: 'rgba(0,12,24,0.85)',
      border: `1px solid ${accent}30`,
      borderRadius: 3,
      overflow: 'hidden',
      boxShadow: isRunning ? `0 0 12px ${accent}20` : 'none',
      animation: isRunning ? 'pulse-glow 2s infinite' : 'none',
    }}>
      {/* Header — clickable to expand */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '7px 9px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          borderBottom: expanded ? `1px solid ${accent}20` : 'none',
        }}
      >
        {/* Status indicator */}
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 6px ${accent}`,
          animation: isRunning ? 'pulse-glow 1.2s infinite' : 'none',
          flexShrink: 0,
        }} />

        {/* ID + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9,
            color: accent,
            fontWeight: 700,
            letterSpacing: '0.1em',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 6,
          }}>
            <span>A-{agent.id.slice(0, 6).toUpperCase()}</span>
            <span style={{ color: 'var(--text-dim)' }}>{elapsed}</span>
          </div>
          <div style={{
            fontSize: 9,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {agent.goal}
          </div>
        </div>

        {/* Expand chevron */}
        <span style={{ color: 'var(--text-dim)', fontSize: 8, transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
      </div>

      {/* Live progress (when expanded or running) */}
      {expanded && (
        <div style={{ padding: '7px 9px', background: 'rgba(0,4,12,0.5)', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Currently executing tool */}
          {agent.currentTool && (
            <div style={{
              fontSize: 8, letterSpacing: '0.15em',
              color: 'var(--accent-amber)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ animation: 'pulse-glow 0.8s infinite' }}>⟐</span>
              EXECUTING · {agent.currentTool.toUpperCase()}
            </div>
          )}

          {/* Live token stream — last 200 chars */}
          {agent.liveText && (
            <div style={{
              fontSize: 9,
              color: 'var(--text-primary)',
              background: 'rgba(0,229,255,0.04)',
              border: '1px solid rgba(0,229,255,0.1)',
              borderRadius: 2,
              padding: '5px 7px',
              maxHeight: 80,
              overflow: 'hidden',
              fontFamily: 'inherit',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {tail(agent.liveText, 240)}
              {isRunning && <span className="cursor-blink" style={{ color: 'var(--accent-primary)' }}>█</span>}
            </div>
          )}

          {/* Tool log */}
          {agent.logs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {agent.logs.slice(-5).map((line, i) => (
                <div key={i} style={{
                  fontSize: 8,
                  color: line.startsWith('▶') ? 'var(--accent-amber)' : 'var(--text-secondary)',
                  letterSpacing: '0.02em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Summary on complete */}
          {agent.summary && (
            <div style={{
              fontSize: 9,
              color: isComplete ? 'var(--accent-green)' : 'var(--accent-red)',
              padding: '5px 7px',
              background: isComplete ? 'rgba(0,255,157,0.05)' : 'rgba(255,59,59,0.05)',
              border: `1px solid ${isComplete ? 'rgba(0,255,157,0.2)' : 'rgba(255,59,59,0.2)'}`,
              borderRadius: 2,
              lineHeight: 1.5,
            }}>
              {agent.summary}
            </div>
          )}

          {/* Kill button for running agents */}
          {isRunning && (
            <button
              onClick={() => authFetch(`${API}/api/agents/${agent.id}`, { method: 'DELETE' })}
              style={{
                background: 'rgba(255,59,59,0.08)',
                border: '1px solid rgba(255,59,59,0.3)',
                color: '#ff5577',
                fontSize: 8,
                letterSpacing: '0.2em',
                padding: '4px 8px',
                borderRadius: 2,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 700,
                alignSelf: 'flex-start',
              }}
            >
              ✕ ABORT
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function tail(s: string, n: number): string {
  return s.length > n ? '…' + s.slice(-n) : s;
}
