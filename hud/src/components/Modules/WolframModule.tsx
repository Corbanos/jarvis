'use client';
import { useCallback, useEffect, useState } from 'react';
import { useJarvisStore } from '@/lib/store';
import { type ModuleInstance } from '@/lib/workspace';
import { authFetch } from '@/lib/auth';
import { WolframCard, type WolframResult } from '@/components/JarvisCards/WolframCard';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

/**
 * Direct line to Wolfram|Alpha. Opens with whatever Jarvis last computed, and
 * the query box lets the operator ask follow-ups without going through chat.
 */
export function WolframModule({ module }: { module: ModuleInstance }) {
  const fromModule = module.data as WolframResult | undefined;
  const messages = useJarvisStore((s) => s.messages);
  const [result, setResult] = useState<WolframResult | null>(fromModule ?? null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    authFetch(`${API}/api/wolfram/status`)
      .then((r) => r.json())
      .then((d: { configured: boolean }) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
  }, []);

  // Fresh data pushed by the tool replaces whatever was showing.
  useEffect(() => { if (fromModule) setResult(fromModule); }, [fromModule]);

  // Nothing pushed yet — show the most recent Wolfram card from chat, if any.
  useEffect(() => {
    if (result) return;
    const latest = findLatestWolfram(messages);
    if (latest) setResult(latest);
  }, [messages, result]);

  const ask = useCallback(async () => {
    const input = query.trim();
    if (!input || busy) return;
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/wolfram/query?input=${encodeURIComponent(input)}`);
      const d = (await res.json()) as WolframResult & { error?: string };
      if (!res.ok) {
        setResult({ input, success: false, pods: [], assumptions: [], didYouMean: [], error: d.error ?? `Request failed (${res.status})` });
      } else {
        setResult(d);
      }
    } catch {
      setResult({ input, success: false, pods: [], assumptions: [], didYouMean: [], error: 'Could not reach the Jarvis server.' });
    } finally {
      setBusy(false);
    }
  }, [query, busy]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(8,4,0,0.6)' }}>
      <div style={{ padding: 10, borderBottom: '1px solid rgba(255,140,0,0.15)', display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
          placeholder={configured === false ? 'Add a Wolfram AppID under 🔌 KEYS first' : 'integrate x^2 sin x   ·   40 psi to bar   ·   moon phase tonight'}
          disabled={configured === false}
          spellCheck={false}
          style={{
            flex: 1, minWidth: 0,
            background: 'rgba(30,12,0,0.6)',
            border: '1px solid rgba(255,140,0,0.25)',
            borderRadius: 3,
            padding: '8px 10px',
            color: 'var(--text-primary)',
            fontSize: 11, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          onClick={() => void ask()}
          disabled={busy || configured === false || !query.trim()}
          style={{
            background: 'rgba(255,140,0,0.1)',
            border: '1px solid rgba(255,140,0,0.4)',
            borderRadius: 3,
            color: 'var(--accent-amber)',
            padding: '8px 14px',
            fontSize: 9, letterSpacing: '0.2em', fontWeight: 700, fontFamily: 'inherit',
            cursor: 'pointer',
            opacity: busy || configured === false || !query.trim() ? 0.4 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? 'COMPUTING…' : 'COMPUTE'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {result
          ? <WolframCard data={result} />
          : (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
              <div style={{ fontSize: 28, color: 'var(--accent-amber)', opacity: 0.35, marginBottom: 8, fontWeight: 900 }}>W|A</div>
              <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>
                {configured === false ? 'NOT CONFIGURED' : 'NO COMPUTATION YET'}
              </div>
              <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7, padding: '0 16px', lineHeight: 1.5 }}>
                {configured === false
                  ? 'Open 🔌 KEYS in the chat header and add your Wolfram|Alpha AppID.'
                  : 'Type a query above, or ask Jarvis anything with a numeric answer.'}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

function findLatestWolfram(messages: Array<{ text: string }>): WolframResult | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]?.text.match(/<jarvis-card type="wolfram">([\s\S]*?)<\/jarvis-card>/);
    if (m?.[1]) {
      try { return JSON.parse(m[1]) as WolframResult; } catch { /* keep looking */ }
    }
  }
  return null;
}
