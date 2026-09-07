'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

type Provider = 'anthropic' | 'ollama' | 'openai';
type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const EFFORTS: Array<{ id: Effort; label: string; blurb: string }> = [
  { id: 'default', label: 'AUTO',   blurb: "The provider's own default for the chosen model." },
  { id: 'low',     label: 'LOW',    blurb: 'Fast and terse. Quick lookups, chat, simple tool calls.' },
  { id: 'medium',  label: 'MEDIUM', blurb: 'Balanced depth and speed for everyday tasks.' },
  { id: 'high',    label: 'HIGH',   blurb: 'Deeper reasoning for multi-step problems and code.' },
  { id: 'xhigh',   label: 'X-HIGH', blurb: 'Extra depth for hard agentic work. Slower.' },
  { id: 'max',     label: 'MAX',    blurb: 'Everything the model has. Correctness over cost and time.' },
];

interface OpenAIStatus {
  configured: boolean;
  source: 'chatgpt' | 'apikey' | null;
  email: string | null;
  plan: string | null;
  importedFrom: 'codex' | null;
  codexLoginAvailable: boolean;
  apiKeyPresent: boolean;
  login: { pending: boolean; done: boolean; error: string | null };
}

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
        title="Model routing — Anthropic, OpenAI (ChatGPT sign-in), or a local Ollama host"
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
  const [effort, setEffort] = useState<Effort>('default');
  const [openai, setOpenai] = useState<OpenAIStatus | null>(null);
  const [openaiModel, setOpenaiModel] = useState('gpt-6-astra');
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const loadOpenaiStatus = useCallback(() => {
    authFetch(`${API}/api/setup/openai/status`).then((r) => r.json()).then((d: OpenAIStatus) => setOpenai(d)).catch(() => {});
  }, []);

  // Load saved routing. The cached model list means the picker is populated
  // even if the Ollama box is asleep right now.
  useEffect(() => {
    authFetch(`${API}/api/setup/provider`)
      .then((r) => r.json())
      .then((d: { provider: Provider; ollamaBaseUrl: string; ollamaModel: string; models: string[]; anthropicConfigured: boolean; openaiModel?: string; openaiModels?: string[]; openai?: OpenAIStatus; effort?: Effort }) => {
        setProvider(d.provider ?? 'anthropic');
        setHost(d.ollamaBaseUrl ?? '');
        setModel(d.ollamaModel ?? '');
        setAnthropicConfigured(!!d.anthropicConfigured);
        if (d.openaiModel) setOpenaiModel(d.openaiModel);
        if (d.openaiModels?.length) setOpenaiModels(d.openaiModels);
        if (d.openai) setOpenai(d.openai);
        if (d.effort) setEffort(d.effort);
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

  // Opens the popup synchronously so browsers don't block it, then points it at
  // the authorize URL once the server has prepared the PKCE challenge. Polls
  // until the callback (or a paste-back) finishes the sign-in.
  const signIn = useCallback(async () => {
    setError(''); setNotice('');
    const popup = window.open('', '_blank');
    setSigningIn(true);
    try {
      const res = await authFetch(`${API}/api/setup/openai/login/start`, { method: 'POST' });
      const d = (await res.json()) as { url: string; listening: boolean };
      if (popup) popup.location.href = d.url; else window.open(d.url, '_blank');
      setNotice(d.listening
        ? 'Finish signing in with ChatGPT in the new tab. This panel updates on its own.'
        : 'Finish signing in, then paste the address the browser lands on below.');
      const started = Date.now();
      const poll = async () => {
        if (Date.now() - started > 10 * 60_000) { setSigningIn(false); return; }
        const st = await authFetch(`${API}/api/setup/openai/login/status`).then((r) => r.json() as Promise<{ pending: boolean; done: boolean; error: string | null }>).catch(() => null);
        if (st?.done) { setSigningIn(false); setNotice('Signed in with ChatGPT.'); loadOpenaiStatus(); void loadOpenaiModels(); return; }
        if (st && !st.pending) { setSigningIn(false); if (st.error) setError(st.error); return; }
        setTimeout(() => { void poll(); }, 2000);
      };
      void poll();
    } catch {
      popup?.close();
      setSigningIn(false);
      setError('Could not start the sign-in.');
    }
  }, [loadOpenaiStatus]);

  const completeFromPaste = useCallback(async () => {
    if (!pasteUrl.trim()) return;
    setError(''); setNotice('');
    const res = await authFetch(`${API}/api/setup/openai/login/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: pasteUrl.trim() }),
    });
    const d = (await res.json()) as { ok: boolean; email?: string | null; error?: string };
    if (!d.ok) { setError(d.error ?? 'Sign-in failed.'); return; }
    setPasteUrl(''); setSigningIn(false);
    setNotice(`Signed in${d.email ? ` as ${d.email}` : ''}.`);
    loadOpenaiStatus(); void loadOpenaiModels();
  }, [pasteUrl, loadOpenaiStatus]);

  const importCodex = useCallback(async () => {
    setError(''); setNotice('');
    const res = await authFetch(`${API}/api/setup/openai/import`, { method: 'POST' });
    const d = (await res.json()) as { ok?: boolean; error?: string; status?: OpenAIStatus };
    if (!res.ok || !d.ok) { setError(d.error ?? 'Import failed.'); return; }
    if (d.status) setOpenai(d.status);
    setNotice(`Imported the Codex CLI sign-in${d.status?.email ? ` (${d.status.email})` : ''}.`);
    void loadOpenaiModels();
  }, []);

  const signOut = useCallback(async () => {
    const res = await authFetch(`${API}/api/setup/openai/logout`, { method: 'POST' });
    const d = (await res.json()) as { status?: OpenAIStatus };
    if (d.status) setOpenai(d.status);
    setNotice('Signed out of ChatGPT.');
  }, []);

  const loadOpenaiModels = useCallback(async () => {
    const res = await authFetch(`${API}/api/setup/openai/models`).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as { models: string[] };
    if (d.models?.length) setOpenaiModels(d.models);
  }, []);

  const apply = useCallback(async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await authFetch(`${API}/api/setup/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ollamaBaseUrl: host, ollamaModel: model, openaiModel: (customModel.trim() || openaiModel), effort }),
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
  }, [provider, host, model, openaiModel, customModel, effort, onClose]);

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
                active={provider === 'openai'}
                onClick={() => { setProvider('openai'); if (!openai) loadOpenaiStatus(); }}
                label="OPENAI"
                sub={openai?.configured ? (openai.source === 'chatgpt' ? (openai.email ?? 'ChatGPT signed in') : 'API key set') : 'ChatGPT sign-in'}
              />
              <Segment
                active={provider === 'ollama'}
                onClick={() => setProvider('ollama')}
                label="OLLAMA"
                sub="local / on-network"
              />
            </div>
          </Section>

          <Section title="THINKING" hint={provider === 'ollama'
            ? 'Ollama models decide this themselves; the setting is kept for when you switch back.'
            : 'How hard the model thinks before answering. Applies to Jarvis and every agent, on whichever provider is live.'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: provider === 'ollama' ? 0.5 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="range"
                  min={0}
                  max={EFFORTS.length - 1}
                  step={1}
                  value={EFFORTS.findIndex((e) => e.id === effort)}
                  onChange={(e) => setEffort(EFFORTS[Number(e.target.value)]!.id)}
                  aria-label="Thinking level"
                  style={{ flex: 1, accentColor: '#00e5ff' }}
                />
                <div style={{ minWidth: 64, textAlign: 'right', color: 'var(--accent-bright)', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em' }}>
                  {EFFORTS.find((e) => e.id === effort)?.label}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
                {EFFORTS.map((e) => (
                  <button key={e.id} onClick={() => setEffort(e.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 8, letterSpacing: '0.1em', color: effort === e.id ? 'var(--accent-primary)' : 'var(--text-dim)', fontWeight: effort === e.id ? 700 : 400 }}>
                    {e.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {EFFORTS.find((e) => e.id === effort)?.blurb}
              </div>
            </div>
          </Section>

          {provider === 'openai' && (
            <>
              <Section title="ACCOUNT" hint="Sign in with ChatGPT to use your subscription through the Codex backend, exactly as the Codex CLI does. Or set OPENAI_API_KEY in .env for the pay-per-token API.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: openai?.configured ? 'var(--accent-green)' : 'var(--text-dim)', lineHeight: 1.6 }}>
                    {openai === null && 'Checking…'}
                    {openai && !openai.configured && '○ Not signed in'}
                    {openai?.configured && openai.source === 'chatgpt' && (
                      <>● Signed in{openai.email ? ` as ${openai.email}` : ''}{openai.plan ? ` · ${openai.plan}` : ''}{openai.importedFrom === 'codex' ? ' · from Codex CLI' : ''}</>
                    )}
                    {openai?.configured && openai.source === 'apikey' && '● Using OPENAI_API_KEY from .env'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {openai?.source !== 'chatgpt' && (
                      <button onClick={() => void signIn()} disabled={signingIn} style={{ ...btnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.4)', background: 'rgba(0,229,255,0.08)', opacity: signingIn ? 0.5 : 1 }}>
                        {signingIn ? 'WAITING FOR BROWSER…' : 'SIGN IN WITH CHATGPT'}
                      </button>
                    )}
                    {openai?.codexLoginAvailable && openai.source !== 'chatgpt' && (
                      <button onClick={() => void importCodex()} style={{ ...btnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.3)' }}>
                        USE CODEX CLI LOGIN
                      </button>
                    )}
                    {openai?.source === 'chatgpt' && (
                      <button onClick={() => void signOut()} style={{ ...btnStyle, color: 'var(--accent-red)', borderColor: 'rgba(255,34,68,0.3)' }}>
                        SIGN OUT
                      </button>
                    )}
                  </div>
                  {signingIn && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={pasteUrl}
                        onChange={(e) => setPasteUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void completeFromPaste(); }}
                        placeholder="On another device? Paste the localhost:1455/… address the browser lands on"
                        spellCheck={false}
                        style={inputStyle}
                      />
                      <button onClick={() => void completeFromPaste()} disabled={!pasteUrl.trim()} style={{ ...btnStyle, color: 'var(--accent-primary)', borderColor: 'rgba(0,229,255,0.4)', opacity: pasteUrl.trim() ? 1 : 0.4, whiteSpace: 'nowrap' }}>
                        FINISH
                      </button>
                    </div>
                  )}
                </div>
              </Section>

              {openai?.configured && (
                <Section title="MODEL" hint="Models available to this account. Tool-calling is required — Jarvis drives its HUD through tools. Type an id the list doesn't show if you know it.">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 3, padding: 4 }}>
                    {(openaiModels.length ? openaiModels : [openaiModel]).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setOpenaiModel(m); setCustomModel(''); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: openaiModel === m && !customModel ? 'rgba(0,229,255,0.12)' : 'transparent',
                          border: `1px solid ${openaiModel === m && !customModel ? 'rgba(0,229,255,0.5)' : 'transparent'}`,
                          borderRadius: 3, padding: '7px 10px',
                          color: openaiModel === m && !customModel ? 'var(--accent-bright)' : 'var(--text-primary)',
                          fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        {openaiModel === m && !customModel ? '● ' : '○ '}{m}
                      </button>
                    ))}
                  </div>
                  <input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="or type a model id…"
                    spellCheck={false}
                    style={{ ...inputStyle, marginTop: 8, width: '100%' }}
                  />
                </Section>
              )}
            </>
          )}

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
            disabled={saving || (provider === 'ollama' && (!host || !model)) || (provider === 'openai' && !openai?.configured)}
            style={{
              ...btnStyle,
              color: 'var(--accent-primary)',
              borderColor: 'rgba(0,229,255,0.4)',
              background: 'rgba(0,229,255,0.08)',
              opacity: saving || (provider === 'ollama' && (!host || !model)) || (provider === 'openai' && !openai?.configured) ? 0.4 : 1,
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
