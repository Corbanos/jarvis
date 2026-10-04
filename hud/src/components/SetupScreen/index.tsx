'use client';
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

type SetupStep = 'enter' | 'testing' | 'success' | 'error';
type AIProvider = 'anthropic' | 'gemini';

interface SetupScreenProps {
  onComplete: () => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [key, setKey] = useState('');
  const [step, setStep] = useState<SetupStep>('enter');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [typedLines, setTypedLines] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Boot sequence typewriter
  useEffect(() => {
    const lines = [
      '> JARVIS INITIALIZATION SEQUENCE...',
      '> Loading subsystems... OK',
      '> WebSocket hub... ONLINE',
      '> Voice engine... STANDBY',
      '> Computer use module... STANDBY',
      '> Browser control... STANDBY',
      '__BLANK__',
      '> AI PROVIDER + API KEY REQUIRED',
      '> Select provider and enter API key',
    ];
    let i = 0;
    const t = setInterval(() => {
      if (i < lines.length) {
        setTypedLines((prev) => [...prev, lines[i++]!]);
      } else {
        clearInterval(t);
        setTimeout(() => inputRef.current?.focus(), 200);
      }
    }, 120);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    authFetch(`${API}/api/setup/status`)
      .then((r) => r.json())
      .then((s: { provider?: AIProvider }) => {
        if (s.provider === 'anthropic' || s.provider === 'gemini') {
          setProvider(s.provider);
        }
      })
      .catch(() => {});
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit();
  };

  const submit = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setStep('testing');
    setError('');

    try {
      const res = await authFetch(`${API}/api/setup/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key: trimmed }),
      });
      const data = await res.json() as { valid: boolean; error?: string; preview?: string };

      if (data.valid) {
        setPreview(data.preview ?? '***');
        setStep('success');
        setTimeout(onComplete, 2200);
      } else {
        setError(data.error ?? 'Validation failed');
        setStep('error');
      }
    } catch (e) {
      setError(`Cannot reach JARVIS server. Is it running on port 7777?`);
      setStep('error');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* Hex grid bg */}
      <HexBg />

      {/* Vignette */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)',
      }} />

      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 640, padding: '0 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: 32, fontWeight: 800, letterSpacing: '0.4em',
            color: '#00e5ff',
            textShadow: '0 0 30px rgba(0,229,255,0.6), 0 0 60px rgba(0,229,255,0.2)',
            marginBottom: 6,
            animation: 'flicker 8s ease-in-out infinite',
          }}>
            J.A.R.V.I.S.
          </div>
          <div style={{ fontSize: 9, color: 'rgba(0,229,255,0.4)', letterSpacing: '0.3em' }}>
            JUST A RATHER VERY INTELLIGENT SYSTEM
          </div>
          <div style={{ fontSize: 8, color: 'rgba(0,229,255,0.2)', letterSpacing: '0.2em', marginTop: 4 }}>
            STARK INDUSTRIES  ·  v2.0
          </div>
        </div>

        {/* Terminal boot log */}
        <div style={{
          background: 'rgba(0,8,18,0.9)',
          border: '1px solid rgba(0,229,255,0.15)',
          borderRadius: 4,
          padding: '16px 20px',
          marginBottom: 24,
          minHeight: 180,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Corner brackets */}
          {(['tl','tr','bl','br'] as const).map((p) => <Corner key={p} pos={p} />)}

          {/* Scan line */}
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.3), transparent)',
            animation: 'scanline 4s linear infinite',
          }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {typedLines.map((line, i) => {
              const safe = line ?? '';
              const isBlank = safe === '__BLANK__';
              const lineColor = safe.startsWith('> ANTHROPIC') ? '#ff9500'
                : safe.startsWith('> JARVIS') ? '#00e5ff'
                : isBlank ? undefined
                : safe.includes('OK') || safe.includes('ONLINE') ? '#00ff9d'
                : 'rgba(0,229,255,0.5)';
              return (
                <div key={i} style={{
                  fontSize: 11, letterSpacing: '0.05em',
                  color: lineColor,
                  animation: 'slide-in-right 0.15s ease',
                  fontWeight: safe.startsWith('> ANTHROPIC') ? 700 : 400,
                  minHeight: isBlank ? 6 : undefined,
                }}>
                  {isBlank ? null : safe}
                </div>
              );
            })}
            {typedLines.length < 9 && (
              <span style={{ color: '#00e5ff', animation: 'blink 1s step-end infinite' }}>█</span>
            )}
          </div>
        </div>

        {/* Key input panel */}
        <div style={{
          background: 'rgba(0,8,18,0.9)',
          border: `1px solid ${step === 'success' ? 'rgba(0,255,157,0.4)' : step === 'error' ? 'rgba(255,34,68,0.4)' : 'rgba(0,229,255,0.2)'}`,
          borderRadius: 4,
          padding: '20px 24px',
          position: 'relative',
          transition: 'border-color 0.3s',
        }}>
          {(['tl','tr','bl','br'] as const).map((p) => (
            <Corner key={p} pos={p}
              color={step === 'success' ? '#00ff9d' : step === 'error' ? '#ff2244' : '#00e5ff'}
            />
          ))}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.2em', marginBottom: 6 }}>
              ANTHROPIC API KEY
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em' }}>
              Retrieve from{' '}
              <span style={{ color: '#00e5ff', textDecoration: 'underline' }}>
                {provider === 'anthropic' ? 'console.anthropic.com' : 'aistudio.google.com/apikey'}
              </span>
              {' '}→ API Keys
            </div>
          </div>

          {step === 'success' ? (
            <SuccessState preview={preview} />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as AIProvider);
                    if (step === 'error') { setStep('enter'); setError(''); }
                  }}
                  disabled={step === 'testing'}
                  style={{
                    width: 170,
                    background: 'rgba(0,15,35,0.8)',
                    border: '1px solid rgba(0,229,255,0.25)',
                    borderRadius: 3,
                    color: '#d0eeff',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    letterSpacing: '0.08em',
                    padding: '10px 10px',
                    outline: 'none',
                  }}
                >
                  <option value="anthropic" style={{ background: '#0a1428', color: '#00e5ff' }}>ANTHROPIC</option>
                  <option value="gemini" style={{ background: '#0a1428', color: '#00e5ff' }}>GEMINI</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 11, color: 'rgba(0,229,255,0.4)', pointerEvents: 'none',
                  }}>›</span>
                  <input
                    ref={inputRef}
                    type="password"
                    value={key}
                    onChange={(e) => { setKey(e.target.value); if (step === 'error') { setStep('enter'); setError(''); } }}
                    onKeyDown={handleKeyDown}
                    placeholder={provider === 'anthropic' ? 'sk-ant-api03-...' : 'AIza...'}
                    disabled={step === 'testing'}
                    style={{
                      width: '100%',
                      background: 'rgba(0,15,35,0.8)',
                      border: `1px solid ${step === 'error' ? 'rgba(255,34,68,0.4)' : 'rgba(0,229,255,0.25)'}`,
                      borderRadius: 3,
                      padding: '10px 12px 10px 26px',
                      color: '#d0eeff',
                      fontSize: 12,
                      fontFamily: 'inherit',
                      letterSpacing: '0.08em',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                  />
                </div>

                <button
                  onClick={submit}
                  disabled={step === 'testing' || !key.trim()}
                  style={{
                    background: step === 'testing' ? 'rgba(0,229,255,0.05)' : 'rgba(0,229,255,0.1)',
                    border: '1px solid rgba(0,229,255,0.35)',
                    borderRadius: 3,
                    color: '#00e5ff',
                    padding: '10px 20px',
                    cursor: step === 'testing' ? 'wait' : 'pointer',
                    fontSize: 10,
                    letterSpacing: '0.2em',
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    transition: 'all 0.2s',
                    flexShrink: 0,
                    opacity: (!key.trim() && step !== 'testing') ? 0.4 : 1,
                    minWidth: 90,
                  }}
                >
                  {step === 'testing' ? <TestingSpinner /> : 'VALIDATE'}
                </button>
              </div>

              {step === 'testing' && (
                <div style={{ fontSize: 10, color: '#00e5ff', letterSpacing: '0.15em', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ animation: 'pulse-glow 0.8s infinite' }}>⟐</span>
                  CONTACTING {provider === 'anthropic' ? 'ANTHROPIC' : 'GEMINI'} API...
                </div>
              )}

              {step === 'error' && error && (
                <div style={{
                  fontSize: 10, color: '#ff4466', letterSpacing: '0.08em',
                  background: 'rgba(255,34,68,0.06)',
                  border: '1px solid rgba(255,34,68,0.2)',
                  borderRadius: 3, padding: '8px 12px',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>✗</span>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 8, color: 'rgba(0,229,255,0.2)', letterSpacing: '0.2em' }}>
          KEY IS STORED LOCALLY IN ~/.jarvis/config.json  ·  NEVER TRANSMITTED
        </div>
      </div>
    </div>
  );
}

function SuccessState({ preview }: { preview: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '2px solid #00ff9d',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#00ff9d', fontSize: 14,
          boxShadow: '0 0 16px rgba(0,255,157,0.4)',
          animation: 'pulse-glow 1.5s infinite',
        }}>✓</div>
        <div>
          <div style={{ fontSize: 11, color: '#00ff9d', fontWeight: 700, letterSpacing: '0.15em' }}>
            API KEY VALIDATED
          </div>
          <div style={{ fontSize: 9, color: 'rgba(0,255,157,0.5)', letterSpacing: '0.1em' }}>
            {preview}  ·  Saved to ~/.jarvis/config.json
          </div>
        </div>
      </div>
      <div style={{ fontSize: 9, color: 'rgba(0,229,255,0.4)', letterSpacing: '0.15em', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ animation: 'pulse-glow 1s infinite' }}>⟐</span>
        INITIALIZING JARVIS...
      </div>
    </div>
  );
}

function TestingSpinner() {
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[0,1,2].map((i) => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: '50%',
          background: '#00e5ff',
          display: 'inline-block',
          animation: `thinking-pulse 0.9s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </span>
  );
}

function Corner({ pos, color = '#00e5ff' }: { pos: 'tl'|'tr'|'bl'|'br'; color?: string }) {
  const size = 10;
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: size, height: size,
      borderTop: pos.includes('t') ? `2px solid ${color}` : undefined,
      borderBottom: pos.includes('b') ? `2px solid ${color}` : undefined,
      borderLeft: pos.includes('l') ? `2px solid ${color}` : undefined,
      borderRight: pos.includes('r') ? `2px solid ${color}` : undefined,
      zIndex: 10,
    }} />
  );
}

function HexBg() {
  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z' fill='none' stroke='rgba(0,180,255,0.04)' stroke-width='0.5'/%3E%3Cpath d='M28 36 L56 52 L56 84 L28 100 L0 84 L0 52 Z' fill='none' stroke='rgba(0,180,255,0.04)' stroke-width='0.5'/%3E%3C/svg%3E")`,
      backgroundSize: '56px 100px',
    }} />
  );
}
