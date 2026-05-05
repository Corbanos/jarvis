'use client';
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface ShellEntry {
  cmd: string;
  output: string;
  status: 'ok' | 'err';
  duration: number;
}

export function ShellModule() {
  const [history, setHistory] = useState<ShellEntry[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, running]);

  const submit = async () => {
    const cmd = input.trim();
    if (!cmd || running) return;
    setInput('');
    setRunning(true);
    const start = Date.now();

    // Use the chat endpoint with a directive prompt so Jarvis dispatches shell tool
    // Direct route would be cleaner — but using existing /api/chat keeps things simple
    try {
      // Direct shell via the existing tool registry would need a new route. Use Jarvis chat:
      const res = await authFetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Run this shell command and return ONLY the raw output, nothing else: ${cmd}`,
          sessionId: 'shell',
        }),
      });
      // Drain SSE stream
      if (res.body) {
        const reader = res.body.getReader();
        while (true) { const { done } = await reader.read(); if (done) break; }
      }
      // We don't have direct output here — fall back: hit shell route
    } catch (e) {
      setHistory((h) => [...h, { cmd, output: `Error: ${e}`, status: 'err', duration: Date.now() - start }]);
      setRunning(false);
      return;
    }

    // Better: hit a direct shell endpoint (we'll add one)
    try {
      const r = await authFetch(`${API}/api/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await r.json() as { output?: string; error?: string };
      setHistory((h) => [...h, {
        cmd,
        output: data.output ?? data.error ?? '',
        status: data.error ? 'err' : 'ok',
        duration: Date.now() - start,
      }]);
    } catch (err) {
      setHistory((h) => [...h, { cmd, output: String(err), status: 'err', duration: Date.now() - start }]);
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, fontSize: 11 }}>
        {history.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em' }}>
            $ Quick shell. Commands run on host as your user.
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>
              <span style={{ color: 'var(--accent-primary)' }}>$</span> {h.cmd}
              <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 9, fontWeight: 400 }}>
                {h.duration}ms
              </span>
            </div>
            <pre style={{
              margin: '2px 0 0 12px',
              fontFamily: 'inherit', fontSize: 10,
              color: h.status === 'err' ? 'var(--accent-red)' : 'var(--text-primary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              lineHeight: 1.5,
            }}>
              {h.output || '(no output)'}
            </pre>
          </div>
        ))}
        {running && (
          <div style={{ color: 'var(--accent-amber)', fontSize: 10 }}>● running…</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        borderTop: '1px solid rgba(0,229,255,0.15)',
        padding: '6px 10px',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={running}
          placeholder="Enter command…"
          style={{
            flex: 1,
            background: 'rgba(0,15,35,0.7)',
            border: '1px solid rgba(0,229,255,0.2)',
            borderRadius: 2,
            padding: '5px 8px',
            color: 'var(--text-primary)',
            fontSize: 11,
            fontFamily: 'inherit',
            outline: 'none',
          }}
          autoFocus
        />
      </div>
    </div>
  );
}
