'use client';
import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import { useJarvisStore } from '@/lib/store';
import { useJarvisChat } from '@/hooks/useJarvisChat';
import { VoiceInput } from '@/components/VoiceInput';

export function JarvisChat() {
  const messages = useJarvisStore((s) => s.messages);
  const thinkingTokens = useJarvisStore((s) => s.thinkingTokens);
  const toolCalls = useJarvisStore((s) => s.toolCalls);
  const { send, loading } = useJarvisChat();
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleVoiceTranscript = (text: string) => {
    send(text);
  };

  // Recent tool calls (deduplicated by name+status)
  const recentTools = toolCalls.slice(-5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 60 }}>
            <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>◈</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.25em' }}>AWAITING YOUR COMMAND, SIR.</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 8, opacity: 0.6 }}>
              Type below or use the microphone
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

        {/* Active tool calls */}
        {recentTools.filter((t) => t.status === 'executing' || t.status === 'starting').map((tc, i) => (
          <ToolCallBadge key={i} {...tc} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: '1px solid rgba(0,229,255,0.1)',
        background: 'rgba(0,4,12,0.95)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {/* Voice + text row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <VoiceInput
            onTranscript={handleVoiceTranscript}
            onListeningChange={setListening}
          />

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
              placeholder={listening ? 'Listening...' : 'Issue a command, sir…'}
              disabled={loading || listening}
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
            disabled={loading || !input.trim() || listening}
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

        {/* Status hint */}
        <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em', textAlign: 'right' }}>
          {loading ? '● JARVIS PROCESSING' : listening ? '● LISTENING' : '● STANDBY · ENTER TO SEND'}
        </div>
      </div>
    </div>
  );
}

function JarvisAvatar({ pulsing }: { pulsing?: boolean }) {
  return (
    <div style={{
      width: 30, height: 30,
      borderRadius: '50%',
      border: '1.5px solid var(--accent-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, color: 'var(--accent-primary)',
      letterSpacing: '0.05em', flexShrink: 0,
      background: 'rgba(0,229,255,0.05)',
      boxShadow: pulsing ? '0 0 12px rgba(0,229,255,0.3)' : 'none',
      animation: pulsing ? 'pulse-glow 1.5s infinite' : 'none',
    }}>J</div>
  );
}

function MessageBubble({ role, text }: { role: string; text: string; id: string; timestamp: number }) {
  const isUser = role === 'user';
  return (
    <div style={{
      display: 'flex', gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      animation: 'slide-in-right 0.25s ease',
    }}>
      {isUser ? (
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          border: '1.5px solid rgba(255,140,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, color: 'var(--accent-amber)', flexShrink: 0,
        }}>SIR</div>
      ) : (
        <JarvisAvatar />
      )}
      <div style={{
        background: isUser ? 'rgba(255,140,0,0.05)' : 'rgba(0,229,255,0.03)',
        border: `1px solid ${isUser ? 'rgba(255,140,0,0.15)' : 'rgba(0,229,255,0.1)'}`,
        borderRadius: isUser ? '8px 2px 8px 8px' : '2px 8px 8px 8px',
        padding: '10px 14px',
        fontSize: 12,
        color: 'var(--text-primary)',
        lineHeight: 1.7,
        maxWidth: '88%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </div>
    </div>
  );
}

function ToolCallBadge({ name, status }: { name: string; status: string }) {
  const executing = status === 'executing' || status === 'starting';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,4,12,0.9)',
      border: '1px solid rgba(255,140,0,0.2)',
      borderRadius: 2, padding: '4px 10px',
      fontSize: 9, color: 'var(--accent-amber)',
      letterSpacing: '0.12em', alignSelf: 'flex-start', marginLeft: 40,
    }}>
      <span style={{ animation: executing ? 'pulse-glow 0.8s infinite' : 'none' }}>⟐</span>
      EXECUTING · {name.toUpperCase().replace('_', ' ')}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--accent-primary)',
          animation: `thinking-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}
