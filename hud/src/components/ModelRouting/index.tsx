'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

type Provider = 'anthropic' | 'ollama';

interface OllamaModel {
  name: string;
  size: number;
  family: string;
  parameterSize: string;
  quantization: string;
}

interface ProbeResult {
  ok: boolean;
  baseUrl: string;
  version?: string;
  models?: OllamaModel[];
  error?: string;
}

export function ModelRoutingButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Model routing — Anthropic or a local Ollama host"
        style={{
          background: 'transparent',
          border: '1px solid rgba(0,229,255,0.25)',
          borderRadius: 3,
          color: 'var(--accent-primary)',
          padding: '4px 10px',
          fontSize: 9,
          letterSpacing: '0.2em',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 700,
        }}
      >
        ⚡ MODEL
      </button>
      {open && <ModelRoutingPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function ModelRoutingPanel({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [host, setHost] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [version, setVersion] = useState('');
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [anthropicConfigured, setAnthropicConfigured] = useState(true);

  // Load saved routing. The cached model list means the picker is populated
  // even if the Ollama box is asleep right now.
  useEffect(() => {
    authFetch(`${API}/api/setup/provider`)
      .then((r) => r.json())
      .then((d: { provider: Provider; ollamaBaseUrl: string; ollamaModel: string; models: string[]; anthropicConfigured: boolean }) => {
        setProvider(d.provider ?? 'anthropic');
        setHost(d.ollamaBaseUrl ?? '');
        setModel(d.ollamaModel ?? '');
        setAnthropicConfigured(!!d.anthropicConfigured);
        if (d.models?.length) {
          setModels(d.models.map((n) => ({ name: n, size: 0, family: '', parameterSize: '', quantization: '' })));
        }
      })
      .catch(() => setError('Could not read current routing.'));
  }, []);

  const probe = useCallback(async () => {
    if (!host.trim()) { setError('Enter a host, e.g. 192.168.1.50:11434'); return; }
    setProbing(true);
    setError('');
    setNotice('');
    try {
      const res = await authFetch(`${API}/api/setup/provider/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: host }),
      });
      const d = (await res.json()) as ProbeResult;
      if (!d.ok) { setError(d.error ?? 'Could not reach that host.'); setModels([]); return; }

      setHost(d.baseUrl);
      setVersion(d.version ?? '');
      setModels(d.models ?? []);
      if (!d.models?.length) {
        setNotice('Connected, but this host has no models pulled yet. Run `ollama pull <model>` on it.');
        return;
      }
      // Keep the current pick if it survived; otherwise take the first.
      if (!d.models.some((m) => m.name === model)) setModel(d.models[0]!.name);
      setNotice(`Connected to Ollama${d.version ? ` v${d.version}` : ''} — ${d.models.length} model${d.models.length === 1 ? '' : 's'} available.`);
    } catch {
      setError('Probe failed — check the address and that Ollama is reachable from this machine.');
    } finally {
      setProbing(false);
    }
  }, [host, model]);

  const apply = useCallback(async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await authFetch(`${API}/api/setup/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ollamaBaseUrl: host, ollamaModel: model }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) { setError(d.error ?? 'Could not save routing.'); return; }
      window.dispatchEvent(new CustomEvent('jarvis-model-routing-changed'));
      onClose();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }, [provider, host, model, onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(0,8,18,0.98)',
          border: '1px solid rgba(0,229,255,0.3)',
          borderRadius: 4,
          width: '100%', maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 0 60px rgba(0,229,255,0.15)',
        }}
      >
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(0,229,255,0.15)',
          background: 'rgba(0,20,40,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.3em', color: 'var(--accent-primary)', fontWeight: 700 }}>
            ◇ MODEL ROUTING
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          <Section title="PROVIDER" hint="Where Jarvis and every agent it spawns send their thinking.">
            <div style={{ display: 'flex', gap: 8 }}>
              <Segment
                active={provider === 'anthropic'}
                onClick={() => setProvider('anthropic')}
                label="ANTHROPIC"
                sub={anthropicConfigured ? 'API key set' : 'no API key'}
              />
              <Segment
                active={provider === 'ollama'}
                onClick={() => setProvider('ollama')}
                label="OLLAMA"
                sub="local / on-network"
              />
            </div>
          </Section>

          {provider === 'ollama' && (
            <>
              <Section title="OLLAMA HOST" hint="Address of the machine running Ollama. Port defaults to 11434 if you leave it off.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void probe(); }}
                    placeholder="192.168.1.50:11434"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => void probe()}
                    disabled={probing}
                    style={{
                      ...btnStyle,
                      color: 'var(--accent-primary)',
                      borderColor: 'rgba(0,229,255,0.4)',
                      background: 'rgba(0,229,255,0.08)',
                      opacity: probing ? 0.5 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {probing ? 'SCANNING…' : 'CONNECT'}
                  </button>
                </div>
              </Section>

              {models.length > 0 && (
                <Section title="MODEL" hint={`Pulled on ${host || 'the host'}${version ? ` · Ollama v${version}` : ''}. Tool-calling models work best — Jarvis drives its HUD through tools.`}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    maxHeight: 220, overflowY: 'auto',
                    border: '1px solid rgba(0,229,255,0.15)', borderRadius: 3, padding: 4,
                  }}>
                    {models.map((m) => (
                      <button
                        key={m.name}
                        onClick={() => setModel(m.name)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          background: model === m.name ? 'rgba(0,229,255,0.12)' : 'transparent',
                          border: `1px solid ${model === m.name ? 'rgba(0,229,255,0.5)' : 'transparent'}`,
                          borderRadius: 3,
                          padding: '7px 10px',
                          color: model === m.name ? 'var(--accent-bright)' : 'var(--text-primary)',
                          fontFamily: 'inherit', fontSize: 11,
                          cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{ fontWeight: model === m.name ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {model === m.name ? '● ' : '○ '}{m.name}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap', letterSpacing: '0.05em' }}>
                          {[m.parameterSize, m.quantization, formatSize(m.size)].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {error && <Banner tone="red">{error}</Banner>}
          {notice && !error && <Banner tone="green">{notice}</Banner>}

          {provider === 'ollama' && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Ollama only listens on loopback by default. To reach it from this machine,
              start it on the other box with <code style={codeStyle}>OLLAMA_HOST=0.0.0.0 ollama serve</code>.
            </div>
          )}
        </div>

        <div style={{
          padding: 16, borderTop: '1px solid rgba(0,229,255,0.15)',
          background: 'rgba(0,20,40,0.4)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button onClick={onClose} style={{ ...btnStyle, color: 'var(--text-dim)', borderColor: 'rgba(255,255,255,0.1)' }}>
            CANCEL
          </button>
          <button
            onClick={() => void apply()}
            disabled={saving || (provider === 'ollama' && (!host || !model))}
            style={{
              ...btnStyle,
              color: 'var(--accent-primary)',
              borderColor: 'rgba(0,229,255,0.4)',
              background: 'rgba(0,229,255,0.08)',
              opacity: saving || (provider === 'ollama' && (!host || !model)) ? 0.4 : 1,
            }}
          >
            {saving ? 'APPLYING…' : 'APPLY'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function Segment({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 3,
        padding: '10px 12px',
        color: active ? 'var(--accent-bright)' : 'var(--text-dim)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>{sub}</div>
    </button>
  );
}

function Banner({ tone, children }: { tone: 'red' | 'green'; children: React.ReactNode }) {
  const red = tone === 'red';
  return (
    <div style={{
      fontSize: 10,
      lineHeight: 1.6,
      color: red ? 'var(--accent-red)' : 'var(--accent-green)',
      background: red ? 'rgba(255,34,68,0.08)' : 'rgba(0,255,157,0.06)',
      border: `1px solid ${red ? 'rgba(255,34,68,0.3)' : 'rgba(0,255,157,0.25)'}`,
      borderRadius: 3,
      padding: '8px 10px',
    }}>
      {children}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700, marginBottom: 4 }}>
        {title}
      </div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(0,15,35,0.8)',
  border: '1px solid rgba(0,229,255,0.2)',
  borderRadius: 3,
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: 11,
  fontFamily: 'inherit',
  outline: 'none',
  letterSpacing: '0.05em',
  minWidth: 0,
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid',
  borderRadius: 3,
  padding: '8px 18px',
  fontSize: 10,
  letterSpacing: '0.2em',
  fontFamily: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  color: 'var(--accent-primary)',
  background: 'rgba(0,229,255,0.08)',
  padding: '1px 4px',
  borderRadius: 2,
};
