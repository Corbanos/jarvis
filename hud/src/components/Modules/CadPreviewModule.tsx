'use client';
import { useState } from 'react';
import { useJarvisStore } from '@/lib/store';
import { type ModuleInstance } from '@/lib/workspace';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface CadData {
  name: string;
  scadPath?: string;
  stlPath?: string | null;
  pngUrl: string;
  stlUrl?: string | null;
  size?: number;
  duration?: number;
}

export function CadPreviewModule({ module }: { module: ModuleInstance }) {
  // Use data from the module's stored data, or fall back to latest CAD card in chat
  const messages = useJarvisStore((s) => s.messages);

  // Prefer module.data if present
  const dataFromModule = module.data as CadData | undefined;

  // Otherwise find latest CAD card in chat history
  const latest = !dataFromModule ? findLatestCadInMessages(messages) : null;
  const data = dataFromModule ?? latest;

  if (!data) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 36, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>◈</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>NO DESIGN LOADED</div>
        <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7, padding: '0 16px', lineHeight: 1.5 }}>
          Ask Jarvis to design something, or open the CAD Library to view past models.
        </div>
      </div>
    );
  }

  return <CadPreviewView data={data} />;
}

function CadPreviewView({ data }: { data: CadData }) {
  const [imgError, setImgError] = useState(false);
  const sizeKB = data.size ? `${(data.size / 1024).toFixed(1)} KB` : '—';
  const duration = data.duration ? `${(data.duration / 1000).toFixed(1)}s` : '—';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(0,8,18,0.5)' }}>

      {/* Big preview */}
      <div style={{
        flex: 1,
        background: 'rgba(0,4,12,0.85)',
        borderBottom: '1px solid rgba(0,229,255,0.15)',
        position: 'relative',
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {/* Reticle decorations */}
        <div style={{ position: 'absolute', top: 8, left: 10, fontSize: 8, color: 'var(--accent-primary)', letterSpacing: '0.2em', opacity: 0.7 }}>VIEW · OBLIQUE</div>
        <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 8, color: 'var(--accent-amber)', letterSpacing: '0.2em' }}>RENDER · {duration}</div>
        <div style={{ position: 'absolute', bottom: 8, left: 10, fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.2em' }}>↑Z  →X  ↗Y</div>
        <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 8, color: 'var(--accent-green)', letterSpacing: '0.2em' }}>● READY</div>

        {/* Crosshair */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 80, height: 80, transform: 'translate(-50%, -50%)', pointerEvents: 'none', opacity: 0.15 }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--accent-primary)' }} />
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--accent-primary)' }} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 18, height: 18, border: '1px solid var(--accent-primary)', borderRadius: '50%' }} />
        </div>

        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${API}${data.pngUrl}`}
            alt={data.name}
            onError={() => setImgError(true)}
            style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', filter: 'drop-shadow(0 0 16px rgba(0,229,255,0.2))' }}
          />
        ) : (
          <div style={{ color: 'var(--accent-red)', fontSize: 11, letterSpacing: '0.2em' }}>
            [PREVIEW UNAVAILABLE]
          </div>
        )}
      </div>

      {/* Stats + actions */}
      <div style={{ padding: '10px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--accent-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>
            {data.name}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.15em' }}>
            {data.stlPath ? 'STL+PNG' : 'PNG ONLY'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <Stat label="STL SIZE" value={sizeKB} />
          <Stat label="RENDER" value={duration} />
          <Stat label="STATUS" value="READY" accent="green" />
        </div>

        {data.scadPath && (
          <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.05em', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.scadPath}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {data.stlUrl && (
            <a
              href={`${API}${data.stlUrl}`}
              download
              style={{
                ...btnStyle,
                color: 'var(--accent-primary)',
                borderColor: 'rgba(0,229,255,0.4)',
                background: 'rgba(0,229,255,0.08)',
                flex: 1,
              }}
            >
              ⬇ DOWNLOAD STL
            </a>
          )}
          <a
            href={`${API}${data.pngUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...btnStyle,
              color: 'var(--text-secondary)',
              borderColor: 'rgba(255,255,255,0.1)',
              flex: 1,
            }}
          >
            FULL IMAGE
          </a>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' }) {
  const color = accent === 'green' ? 'var(--accent-green)' : accent === 'amber' ? 'var(--accent-amber)' : 'var(--accent-bright)';
  return (
    <div style={{
      background: 'rgba(0,12,24,0.6)',
      border: '1px solid rgba(0,229,255,0.1)',
      borderRadius: 2, padding: '5px 8px',
    }}>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.2em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '7px 12px',
  fontSize: 9,
  letterSpacing: '0.2em',
  fontFamily: 'inherit',
  fontWeight: 700,
  textDecoration: 'none',
  border: '1px solid',
  borderRadius: 3,
  cursor: 'pointer',
  textAlign: 'center',
};

function findLatestCadInMessages(messages: Array<{ text: string; timestamp: number }>): CadData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const match = m.text.match(/<jarvis-card type="cad">([\s\S]*?)<\/jarvis-card>/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]) as CadData;
      } catch { /* keep looking */ }
    }
  }
  return null;
}
