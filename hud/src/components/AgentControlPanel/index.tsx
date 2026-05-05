'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useJarvisStore, type AgentRecord } from '@/lib/store';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

export function AgentControlPanel() {
  const agents = useJarvisStore((s) => s.agents);
  const focusedAgentId = useJarvisStore((s) => s.focusedAgentId);
  const setFocusedAgent = useJarvisStore((s) => s.setFocusedAgent);
  const currentModel = useJarvisStore((s) => s.currentModel);
  const availableModels = useJarvisStore((s) => s.availableModels);
  const setCurrentModel = useJarvisStore((s) => s.setCurrentModel);
  const setAgents = useJarvisStore((s) => s.setAgents);
  const clearAgentHistory = useJarvisStore((s) => s.clearAgentHistory);

  const [view, setView] = useState<'active' | 'history'>('active');

  // Load agents and model info on mount
  useEffect(() => {
    authFetch(`${API}/api/agents`)
      .then((r) => r.json())
      .then((data: AgentRecord[]) => {
        if (Array.isArray(data)) {
          setAgents(data);
        }
      })
      .catch(() => {});

    authFetch(`${API}/api/model`)
      .then((r) => r.json())
      .then((data: { current: string; available: string[] }) => {
        if (data.current) setCurrentModel(data.current);
      })
      .catch(() => {});
  }, [setAgents, setCurrentModel]);

  const activeAgents = agents.filter((a) => a.status === 'running');
  const historicalAgents = agents.filter((a) => a.status !== 'running');
  const focusedAgent = agents.find((a) => a.id === focusedAgentId);

  const handleModelChange = async (model: string) => {
    try {
      const res = await authFetch(`${API}/api/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        setCurrentModel(model);
      }
    } catch {
      // ignore
    }
  };

  const handleClearHistory = async () => {
    try {
      await authFetch(`${API}/api/agents/history`, { method: 'DELETE' });
      clearAgentHistory();
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'rgba(0,8,16,0.95)',
      fontFamily: 'inherit'
    }}>
      {/* Header with model selector */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid rgba(0,229,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        {/* Model Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ 
            fontSize: 8, 
            letterSpacing: '0.15em', 
            color: 'var(--text-dim)',
            fontWeight: 600,
          }}>
            MODEL
          </span>
          <select
            value={currentModel}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              background: 'rgba(0,229,255,0.08)',
              border: '1px solid rgba(0,229,255,0.3)',
              borderRadius: 3,
              color: 'var(--accent-primary)',
              fontSize: 9,
              padding: '4px 8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.05em',
            }}
          >
            {availableModels.map((m) => (
              <option key={m} value={m} style={{ background: '#0a1428', color: '#00e5ff' }}>
                {formatModelName(m)}
              </option>
            ))}
          </select>
        </div>

        {/* View Toggle */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <TabButton 
            active={view === 'active'} 
            onClick={() => setView('active')}
            count={activeAgents.length}
          >
            ACTIVE
          </TabButton>
          <TabButton 
            active={view === 'history'} 
            onClick={() => setView('history')}
            count={historicalAgents.length}
          >
            HISTORY
          </TabButton>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Agent List */}
        <div style={{ 
          width: focusedAgent ? '35%' : '100%',
          minWidth: focusedAgent ? 180 : undefined,
          borderRight: focusedAgent ? '1px solid rgba(0,229,255,0.15)' : 'none',
          overflowY: 'auto',
          transition: 'width 0.2s ease',
        }}>
          {view === 'active' ? (
            activeAgents.length === 0 ? (
              <EmptyState message="NO ACTIVE AGENTS" />
            ) : (
              activeAgents.map((agent) => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  focused={agent.id === focusedAgentId}
                  onClick={() => setFocusedAgent(agent.id === focusedAgentId ? null : agent.id)}
                  compact={!!focusedAgent}
                />
              ))
            )
          ) : (
            <>
              {historicalAgents.length === 0 ? (
                <EmptyState message="NO AGENT HISTORY" />
              ) : (
                <>
                  {historicalAgents.slice(0, 50).map((agent) => (
                    <AgentListItem
                      key={agent.id}
                      agent={agent}
                      focused={agent.id === focusedAgentId}
                      onClick={() => setFocusedAgent(agent.id === focusedAgentId ? null : agent.id)}
                      compact={!!focusedAgent}
                    />
                  ))}
                  {historicalAgents.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      style={{
                        width: 'calc(100% - 16px)',
                        margin: '8px',
                        padding: '6px 12px',
                        background: 'rgba(255,59,59,0.08)',
                        border: '1px solid rgba(255,59,59,0.3)',
                        borderRadius: 3,
                        color: '#ff5577',
                        fontSize: 8,
                        letterSpacing: '0.15em',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      CLEAR HISTORY
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Focused Agent Detail Panel */}
        {focusedAgent && (
          <AgentDetailPanel 
            agent={focusedAgent} 
            onClose={() => setFocusedAgent(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({ 
  active, 
  onClick, 
  children, 
  count 
}: { 
  active: boolean; 
  onClick: () => void; 
  children: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(0,229,255,0.15)' : 'transparent',
        border: `1px solid ${active ? 'rgba(0,229,255,0.4)' : 'rgba(0,229,255,0.2)'}`,
        borderRadius: 2,
        color: active ? 'var(--accent-primary)' : 'var(--text-dim)',
        fontSize: 8,
        letterSpacing: '0.15em',
        padding: '4px 8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {children}
      <span style={{
        background: active ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '1px 5px',
        fontSize: 7,
      }}>
        {count}
      </span>
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 150,
      color: 'var(--text-dim)',
      fontSize: 9,
      letterSpacing: '0.2em',
      gap: 8,
    }}>
      <div style={{ fontSize: 24, opacity: 0.2 }}>◇</div>
      {message}
    </div>
  );
}

function AgentListItem({ 
  agent, 
  focused, 
  onClick,
  compact,
}: { 
  agent: AgentRecord; 
  focused: boolean; 
  onClick: () => void;
  compact: boolean;
}) {
  const isRunning = agent.status === 'running';
  const isComplete = agent.status === 'complete';
  const isFailed = agent.status === 'failed';

  const accent = isRunning ? '#ff8c00' : isComplete ? '#00ff9d' : isFailed ? '#ff3b3b' : '#00e5ff';
  const elapsed = agent.completedAt
    ? `${((agent.completedAt - agent.startedAt) / 1000).toFixed(1)}s`
    : `${Math.floor((Date.now() - agent.startedAt) / 1000)}s`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: compact ? '8px 10px' : '10px 12px',
        borderBottom: '1px solid rgba(0,229,255,0.08)',
        cursor: 'pointer',
        background: focused ? 'rgba(0,229,255,0.08)' : 'transparent',
        borderLeft: focused ? `2px solid ${accent}` : '2px solid transparent',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status indicator */}
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: accent,
          boxShadow: isRunning ? `0 0 8px ${accent}` : 'none',
          animation: isRunning ? 'pulse-glow 1.5s infinite' : 'none',
          flexShrink: 0,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Agent ID + Time */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ 
              fontSize: 9, 
              color: accent, 
              fontWeight: 700, 
              letterSpacing: '0.1em' 
            }}>
              A-{agent.id.slice(0, 6).toUpperCase()}
            </span>
            <span style={{ 
              fontSize: 8, 
              color: 'var(--text-dim)',
              letterSpacing: '0.1em',
            }}>
              {elapsed}
            </span>
          </div>

          {/* Goal */}
          <div style={{
            fontSize: 9,
            color: 'var(--text-secondary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {agent.goal.slice(0, compact ? 40 : 80)}
          </div>

          {/* Model badge */}
          {agent.model && (
            <div style={{
              fontSize: 7,
              color: 'var(--text-dim)',
              marginTop: 3,
              letterSpacing: '0.1em',
            }}>
              {formatModelName(agent.model)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentDetailPanel({ 
  agent, 
  onClose 
}: { 
  agent: AgentRecord; 
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const isRunning = agent.status === 'running';
  const accent = isRunning ? '#ff8c00' : agent.status === 'complete' ? '#00ff9d' : '#ff3b3b';

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.logs.length, agent.liveText]);

  const handleAbort = async () => {
    try {
      await authFetch(`${API}/api/agents/${agent.id}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
  };

  const handleSendInstruction = async () => {
    if (!instruction.trim() || sending) return;
    setSending(true);
    try {
      await authFetch(`${API}/api/agents/${agent.id}/instruct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      setInstruction('');
    } catch {
      // ignore
    }
    setSending(false);
  };

  const elapsed = agent.completedAt
    ? ((agent.completedAt - agent.startedAt) / 1000).toFixed(1)
    : Math.floor((Date.now() - agent.startedAt) / 1000);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid rgba(0,229,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: accent,
              boxShadow: isRunning ? `0 0 10px ${accent}` : 'none',
              animation: isRunning ? 'pulse-glow 1.5s infinite' : 'none',
            }} />
            <span style={{ 
              fontSize: 11, 
              color: accent, 
              fontWeight: 700, 
              letterSpacing: '0.1em' 
            }}>
              AGENT {agent.id.slice(0, 8).toUpperCase()}
            </span>
            <span style={{
              fontSize: 8,
              color: 'var(--text-dim)',
              padding: '2px 6px',
              background: 'rgba(0,229,255,0.08)',
              borderRadius: 2,
              letterSpacing: '0.1em',
            }}>
              {agent.status.toUpperCase()}
            </span>
          </div>
          <div style={{
            fontSize: 9,
            color: 'var(--text-secondary)',
            marginTop: 4,
            lineHeight: 1.4,
          }}>
            {agent.goal}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            fontSize: 16,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid rgba(0,229,255,0.1)',
        display: 'flex',
        gap: 16,
        fontSize: 8,
        letterSpacing: '0.1em',
      }}>
        <Stat label="ELAPSED" value={`${elapsed}s`} />
        <Stat label="LOGS" value={agent.logs.length.toString()} />
        <Stat label="MODEL" value={formatModelName(agent.model ?? 'unknown')} />
      </div>

      {/* Logs Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 12px',
        fontSize: 9,
        lineHeight: 1.6,
        fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
      }}>
        {agent.logs.map((log, i) => (
          <LogLine key={i} text={log} />
        ))}

        {/* Live streaming text */}
        {agent.liveText && (
          <div style={{
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(0,229,255,0.03)',
            padding: '6px 8px',
            borderRadius: 3,
            border: '1px solid rgba(0,229,255,0.1)',
            marginTop: 8,
          }}>
            {agent.liveText.slice(-1000)}
            {isRunning && <span style={{ color: accent, animation: 'pulse-glow 0.8s infinite' }}>█</span>}
          </div>
        )}

        {/* Current tool indicator */}
        {agent.currentTool && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            color: '#ff8c00',
            fontSize: 8,
            letterSpacing: '0.15em',
          }}>
            <span style={{ animation: 'pulse-glow 0.6s infinite' }}>⟐</span>
            EXECUTING {agent.currentTool.toUpperCase()}
          </div>
        )}

        <div ref={logsEndRef} />
      </div>

      {/* Action Bar */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid rgba(0,229,255,0.15)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {/* Live Instruction Input (only for running agents) */}
        {isRunning && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendInstruction()}
              placeholder="Send live instruction..."
              style={{
                flex: 1,
                background: 'rgba(0,229,255,0.05)',
                border: '1px solid rgba(0,229,255,0.25)',
                borderRadius: 3,
                padding: '6px 10px',
                fontSize: 10,
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleSendInstruction}
              disabled={sending || !instruction.trim()}
              style={{
                background: 'rgba(0,229,255,0.15)',
                border: '1px solid rgba(0,229,255,0.4)',
                borderRadius: 3,
                color: 'var(--accent-primary)',
                fontSize: 8,
                letterSpacing: '0.15em',
                padding: '6px 12px',
                cursor: sending || !instruction.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !instruction.trim() ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              SEND
            </button>
          </div>
        )}

        {/* Abort Button */}
        {isRunning && (
          <button
            onClick={handleAbort}
            style={{
              background: 'rgba(255,59,59,0.1)',
              border: '1px solid rgba(255,59,59,0.4)',
              borderRadius: 3,
              color: '#ff5577',
              fontSize: 9,
              letterSpacing: '0.15em',
              padding: '8px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            ✕ ABORT AGENT
          </button>
        )}

        {/* Summary for completed agents */}
        {!isRunning && agent.summary && (
          <div style={{
            padding: '8px 10px',
            background: agent.status === 'complete' 
              ? 'rgba(0,255,157,0.05)' 
              : 'rgba(255,59,59,0.05)',
            border: `1px solid ${agent.status === 'complete' 
              ? 'rgba(0,255,157,0.2)' 
              : 'rgba(255,59,59,0.2)'}`,
            borderRadius: 3,
            fontSize: 9,
            color: agent.status === 'complete' ? '#00ff9d' : '#ff5577',
            lineHeight: 1.5,
          }}>
            {agent.summary}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: 'var(--text-dim)' }}>{label}:</span>{' '}
      <span style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

function LogLine({ text }: { text: string }) {
  const isToolCall = text.startsWith('▶') || text.startsWith('[');
  const isResult = text.startsWith('  ←');
  const isInstruction = text.includes('INSTRUCTION:');
  const isError = text.toLowerCase().includes('error') || text.includes('[KILLED') || text.includes('[ABORTED');
  const isComplete = text.includes('TASK COMPLETE:');
  const isFailed = text.includes('TASK FAILED:');

  let color = 'var(--text-secondary)';
  if (isToolCall) color = '#ff8c00';
  if (isResult) color = 'var(--text-dim)';
  if (isInstruction) color = '#00e5ff';
  if (isError) color = '#ff5577';
  if (isComplete) color = '#00ff9d';
  if (isFailed) color = '#ff5577';

  return (
    <div style={{
      color,
      marginBottom: 4,
      wordBreak: 'break-word',
      whiteSpace: 'pre-wrap',
    }}>
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatModelName(m: string): string {
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
