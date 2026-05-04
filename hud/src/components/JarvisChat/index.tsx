'use client';
import { useRef, useEffect, useState, KeyboardEvent } from 'react';
import { useJarvisStore } from '@/lib/store';
import { useJarvisChat } from '@/hooks/useJarvisChat';

export function JarvisChat() {
  const messages = useJarvisStore((s) => s.messages);
  const thinkingTokens = useJarvisStore((s) => s.thinkingTokens);
  const toolCalls = useJarvisStore((s) => s.toolCalls);
  const { send, loading } = useJarvisChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingTokens]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) {
        send(input.trim());
        setInput('');
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, marginTop: 40, letterSpacing: '0.1em' }}>
            <div style={{ fontSize: 24, color: 'var(--accent-primary)', marginBottom: 8 }}>◈</div>
            <div>AWAITING YOUR COMMAND, SIR.</div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} {...msg} />
        ))}

        {/* Thinking stream */}
        {loading && thinkingTokens && (
          <div style={{
            display: 'flex',
            gap: 12,
            animation: 'slide-in-right 0.2s ease',
          }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '1px solid var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: 'var(--accent-primary)',
              flexShrink: 0,
              animation: 'pulse-glow 1.5s infinite',
            }}>J</div>
            <div style={{
              background: 'rgba(0,212,255,0.04)',
              border: '1px solid rgba(0,212,255,0.15)',
              borderRadius: '2px 12px 12px 12px',
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--text-primary)',
              lineHeight: 1.6,
              maxWidth: '85%',
              whiteSpace: 'pre-wrap',
            }}>
              {thinkingTokens}
              <span className="cursor-blink" style={{ color: 'var(--accent-primary)' }}>█</span>
            </div>
          </div>
        )}

        {/* Loading with no tokens yet */}
        {loading && !thinkingTokens && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--accent-primary)', animation: 'pulse-glow 1.5s infinite' }}>J</div>
            <ThinkingDots />
          </div>
        )}

        {/* Recent tool calls */}
        {toolCalls.slice(-3).map((tc, i) => (
          <ToolCallChip key={i} {...tc} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(0,100,150,0.2)',
        background: 'rgba(0,10,25,0.6)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--accent-primary)',
            fontSize: 11,
            letterSpacing: '0.1em',
            pointerEvents: 'none',
          }}>›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Issue a command, sir…"
            disabled={loading}
            rows={1}
            style={{
              width: '100%',
              background: 'rgba(0,20,40,0.7)',
              border: '1px solid rgba(0,212,255,0.2)',
              borderRadius: 4,
              padding: '10px 12px 10px 28px',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              minHeight: 40,
              maxHeight: 120,
              overflow: 'hidden',
              letterSpacing: '0.05em',
              transition: 'border-color 0.2s',
            }}
          />
        </div>
        <button
          onClick={() => { if (input.trim()) { send(input.trim()); setInput(''); } }}
          disabled={loading || !input.trim()}
          style={{
            background: loading ? 'rgba(0,100,150,0.3)' : 'rgba(0,212,255,0.1)',
            border: '1px solid rgba(0,212,255,0.3)',
            borderRadius: 4,
            color: 'var(--accent-primary)',
            padding: '10px 16px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 11,
            letterSpacing: '0.1em',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
        >
          {loading ? '●●●' : 'SEND'}
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ role, text }: { role: string; text: string; timestamp: number; id: string }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', gap: 12, flexDirection: isUser ? 'row-reverse' : 'row', animation: 'slide-in-right 0.2s ease' }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: `1px solid ${isUser ? 'rgba(255,149,0,0.5)' : 'var(--accent-primary)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        color: isUser ? 'var(--accent-amber)' : 'var(--accent-primary)',
        letterSpacing: '0.05em',
        flexShrink: 0,
      }}>
        {isUser ? 'SIR' : 'J'}
      </div>
      <div style={{
        background: isUser ? 'rgba(255,149,0,0.06)' : 'rgba(0,212,255,0.04)',
        border: `1px solid ${isUser ? 'rgba(255,149,0,0.15)' : 'rgba(0,212,255,0.12)'}`,
        borderRadius: isUser ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
        padding: '10px 14px',
        fontSize: 12,
        color: 'var(--text-primary)',
        lineHeight: 1.65,
        maxWidth: '85%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </div>
    </div>
  );
}

function ToolCallChip({ name, status }: { name: string; status: string }) {
  const color = status === 'executing' ? 'var(--accent-amber)' : 'var(--accent-green)';
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      background: 'rgba(0,20,40,0.8)',
      border: `1px solid ${color}30`,
      borderRadius: 3,
      padding: '4px 10px',
      fontSize: 10,
      color,
      letterSpacing: '0.1em',
      alignSelf: 'flex-start',
      marginLeft: 40,
    }}>
      <span style={{ animation: status === 'executing' ? 'thinking-pulse 1s infinite' : 'none' }}>⟐</span>
      TOOL: {name.toUpperCase()} — {status.toUpperCase()}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '12px 0' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: 'var(--accent-primary)',
          animation: `thinking-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}
