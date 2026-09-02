'use client';
import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import { useJarvisStore } from '@/lib/store';
import { useJarvisChat } from '@/hooks/useJarvisChat';
import { useWakeWord, type WakeState } from '@/hooks/useWakeWord';
import { useJarvisTTS } from '@/hooks/useJarvisTTS';
import { JarvisRichResponse } from '@/components/JarvisCards';
import { SettingsButton } from '@/components/SettingsPanel';
import { ModelRoutingButton } from '@/components/ModelRouting';
import { useVoiceConfig } from '@/lib/voice-config';

export function JarvisChat() {
  const messages = useJarvisStore((s) => s.messages);
  const thinkingTokens = useJarvisStore((s) => s.thinkingTokens);
  const toolCalls = useJarvisStore((s) => s.toolCalls);
  const { send, loading } = useJarvisChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useJarvisTTS();

  const { state: wakeState, lastTranscript, goToSleep } = useWakeWord({
    onTranscript: (text) => {
      if (!loading) send(text);
    },
    enabled: true,
  });

  // When AI calls the dismiss tool, server broadcasts a 'dismiss' event;
  // store bumps dismissNonce; we react by going to sleep.
  const dismissNonce = useJarvisStore((s) => s.dismissNonce);
  useEffect(() => {
    if (dismissNonce > 0) goToSleep('AI called dismiss tool');
  }, [dismissNonce, goToSleep]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingTokens, toolCalls]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    if (input.trim() && !loading) {
      send(input.trim());
      setInput('');
    }
  };

  const activeTools = toolCalls.slice(-5).filter((t) => t.status === 'executing' || t.status === 'starting');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Wake word status bar */}
      <WakeStatusBar state={wakeState} lastTranscript={lastTranscript} loading={loading} />

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 50 }}>
            <div style={{ fontSize: 36, color: 'var(--accent-primary)', opacity: 0.2, marginBottom: 12 }}>◈</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.25em', marginBottom: 6 }}>
              AWAITING YOUR COMMAND, SIR.
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', opacity: 0.6 }}>
              Say <span style={{ color: 'var(--accent-amber)' }}>"Hey Jarvis"</span> or type below
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} {...msg} />
        ))}

        {/* Live thinking stream */}
        {loading && thinkingTokens && (
          <div style={{ display: 'flex', gap: 10, animation: 'slide-in-right 0.2s ease' }}>
            <JarvisAvatar pulsing />
            <div style={{
              background: 'rgba(0,229,255,0.03)',
              border: '1px solid rgba(0,229,255,0.12)',
              borderRadius: '2px 8px 8px 8px',
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--text-primary)',
              lineHeight: 1.65,
              maxWidth: '88%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {thinkingTokens}
              <span className="cursor-blink" style={{ color: 'var(--accent-primary)', marginLeft: 1 }}>█</span>
            </div>
          </div>
        )}

        {loading && !thinkingTokens && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <JarvisAvatar pulsing />
            <ThinkingDots />
          </div>
        )}

        {activeTools.map((tc, i) => (
          <ToolCallBadge key={i} {...tc} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Text input */}
      <div style={{
        borderTop: '1px solid rgba(0,229,255,0.1)',
        background: 'rgba(0,4,12,0.95)',
        padding: '10px 14px',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
      }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--accent-primary)', fontSize: 12, pointerEvents: 'none',
          }}>›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={wakeState === 'recording' ? 'Listening…' : wakeState === 'processing' ? 'Processing…' : 'Type a command, or say "Hey Jarvis"…'}
            disabled={loading}
            rows={1}
            style={{
              width: '100%',
              background: 'rgba(0,15,35,0.8)',
              border: `1px solid ${loading ? 'rgba(0,229,255,0.1)' : 'rgba(0,229,255,0.25)'}`,
              borderRadius: 3,
              padding: '9px 10px 9px 26px',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              minHeight: 38,
              maxHeight: 100,
              overflow: 'auto',
              letterSpacing: '0.04em',
              transition: 'border-color 0.2s',
              lineHeight: 1.5,
            }}
          />
        </div>

        <button
          onClick={submit}
          disabled={loading || !input.trim()}
          style={{
            background: 'rgba(0,229,255,0.08)',
            border: '1px solid rgba(0,229,255,0.3)',
            borderRadius: 3,
            color: 'var(--accent-primary)',
            padding: '9px 14px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 10,
            letterSpacing: '0.15em',
            fontFamily: 'inherit',
            fontWeight: 700,
            transition: 'all 0.2s',
            flexShrink: 0,
            opacity: (loading || !input.trim()) ? 0.4 : 1,
          }}
        >
          {loading ? '···' : 'SEND'}
        </button>
      </div>
    </div>
  );
}

// ── Wake word status bar ──────────────────────────────────────

function WakeStatusBar({ state, lastTranscript, loading }: { state: WakeState; lastTranscript: string; loading: boolean }) {
  const stateConfig: Record<WakeState, { label: string; color: string; pulse: boolean }> = {
    asleep: { label: 'ASLEEP · SAY WAKE WORD', color: 'var(--text-dim)', pulse: false },
    awake: { label: 'AWAKE · LISTENING', color: 'var(--accent-green)', pulse: true },
    recording: { label: 'RECORDING', color: 'var(--accent-amber)', pulse: true },
    processing: { label: 'PROCESSING', color: 'var(--accent-primary)', pulse: true },
  };

  const cfg = loading
    ? { label: 'JARVIS THINKING', color: 'var(--accent-primary)', pulse: true }
    : stateConfig[state];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '5px 14px',
      borderBottom: '1px solid rgba(0,229,255,0.08)',
      background: 'rgba(0,4,12,0.6)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1 }}>
        {/* Animated dot */}
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: cfg.color,
          boxShadow: `0 0 6px ${cfg.color}`,
          animation: cfg.pulse ? 'pulse-glow 1.5s infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 8,
          letterSpacing: '0.2em',
          color: cfg.color,
          fontWeight: 700,
        }}>
          {cfg.label}
        </span>

        {/* Voice waveform bars when recording */}
        {(state === 'recording' || state === 'awake') && (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginLeft: 4 }}>
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                style={{
                  width: 2,
                  height: state === 'recording' ? `${6 + Math.sin(Date.now() / 200 + i) * 4}px` : '3px',
                  background: cfg.color,
                  borderRadius: 1,
                  opacity: state === 'recording' ? 0.8 : 0.3,
                  animation: state === 'recording' ? `thinking-pulse ${0.4 + i * 0.1}s ease-in-out infinite alternate` : 'none',
                  transition: 'height 0.1s',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Last transcript preview */}
      {lastTranscript && (
        <span style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.05em', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          "{lastTranscript}"
        </span>
      )}
      <ActiveProjectBadge />
      <MicToggle />
      <ModelRoutingButton />
      <SettingsButton />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function JarvisAvatar({ pulsing }: { pulsing?: boolean }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%',
      border: '1.5px solid var(--accent-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, color: 'var(--accent-primary)',
      flexShrink: 0, background: 'rgba(0,229,255,0.05)',
      boxShadow: pulsing ? '0 0 12px rgba(0,229,255,0.3)' : 'none',
      animation: pulsing ? 'pulse-glow 1.5s infinite' : 'none',
    }}>J</div>
  );
}

function MessageBubble({ role, text }: { role: string; text: string; id: string; timestamp: number }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', gap: 10, flexDirection: isUser ? 'row-reverse' : 'row', animation: 'slide-in-right 0.25s ease' }}>
      {isUser ? (
        <div style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid rgba(255,140,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--accent-amber)', flexShrink: 0 }}>SIR</div>
      ) : (
        <JarvisAvatar />
      )}
      <div style={{
        background: isUser ? 'rgba(255,140,0,0.05)' : 'rgba(0,229,255,0.03)',
        border: `1px solid ${isUser ? 'rgba(255,140,0,0.15)' : 'rgba(0,229,255,0.1)'}`,
        borderRadius: isUser ? '8px 2px 8px 8px' : '2px 8px 8px 8px',
        padding: '10px 14px', fontSize: 12, color: 'var(--text-primary)',
        lineHeight: 1.7, maxWidth: '88%', wordBreak: 'break-word',
      }}>
        {isUser ? text : <JarvisRichResponse text={text} />}
      </div>
    </div>
  );
}

function ToolCallBadge({ name, status }: { name: string; status: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,4,12,0.9)', border: '1px solid rgba(255,140,0,0.2)',
      borderRadius: 2, padding: '4px 10px', fontSize: 9,
      color: 'var(--accent-amber)', letterSpacing: '0.12em',
      alignSelf: 'flex-start', marginLeft: 40,
    }}>
      <span style={{ animation: 'pulse-glow 0.8s infinite' }}>⟐</span>
      EXECUTING · {name.toUpperCase().replace('_', ' ')}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-primary)',
          animation: `thinking-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function ActiveProjectBadge() {
  // Use the existing zustand store via a simple hook reference at module scope.
  const id = useJarvisStore((s) => s.activeProjectId);
  const name = useJarvisStore((s) => s.activeProjectName);
  if (!id) return null;
  return (
    <div title="Active project — chat is bound to this. Click to scroll to PROJECTS." style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 8px',
      background: 'rgba(0,229,255,0.12)',
      border: '1px solid rgba(0,229,255,0.45)',
      borderRadius: 3,
      fontSize: 8, letterSpacing: '0.15em',
      color: 'var(--accent-bright)',
      maxWidth: 180,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontWeight: 700,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00e5ff', boxShadow: '0 0 6px #00e5ff' }} />
      INIT · {name?.toUpperCase()}
    </div>
  );
}

function MicToggle() {
  const muted = useVoiceConfig((s) => s.micMuted);
  const setMuted = useVoiceConfig((s) => s.setMicMuted);
  return (
    <button
      onClick={() => setMuted(!muted)}
      title={muted ? 'Unmute mic' : 'Mute mic'}
      style={{
        background: muted ? 'rgba(255,59,59,0.12)' : 'transparent',
        border: `1px solid ${muted ? 'rgba(255,59,59,0.5)' : 'rgba(0,229,255,0.25)'}`,
        borderRadius: 3,
        color: muted ? 'var(--accent-red)' : 'var(--accent-primary)',
        padding: '4px 9px',
        fontSize: 9,
        letterSpacing: '0.2em',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 700,
        transition: 'all 0.2s',
      }}
    >
      {muted ? '🔇 MUTED' : '🎤 LIVE'}
    </button>
  );
}
