'use client';
import { useState } from 'react';
import { withAuthToken } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface CadCardData {
  name: string;
  scadPath?: string;
  stlPath?: string | null;
  pngUrl: string;
  stlUrl?: string | null;
  size?: number;
  duration?: number;
}

export function CadCard({ data }: { data: CadCardData }) {
  const [imgError, setImgError] = useState(false);
  if (!data?.pngUrl) return null;

  const sizeKB = data.size ? `${(data.size / 1024).toFixed(1)} KB` : '—';
  const durationS = data.duration ? `${(data.duration / 1000).toFixed(1)}s` : '—';

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(0,15,30,0.95) 0%, rgba(0,8,18,0.95) 100%)',
      border: '1px solid rgba(0,229,255,0.3)',
      borderRadius: 4,
      padding: '12px 14px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 0 24px rgba(0,180,255,0.08)',
    }}>
      {(['tl','tr','bl','br'] as const).map((p) => <CornerBracket key={p} pos={p} />)}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1, top: 0,
        background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.4), transparent)',
        animation: 'scanline 6s linear infinite', pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(0,229,255,0.1)' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-amber)', boxShadow: '0 0 6px var(--accent-amber)' }} />
        <span style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700 }}>
          ◇ CAD MODEL
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(0,229,255,0.15)' }} />
        <span style={{ fontSize: 9, color: 'var(--accent-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>
          {data.name?.toUpperCase()}
        </span>
      </div>

      {/* Preview image */}
      <div style={{
        background: 'rgba(0,8,18,0.7)',
        border: '1px solid rgba(0,229,255,0.15)',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 10,
        aspectRatio: '4/3',
        position: 'relative',
      }}>
        {!imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={withAuthToken(`${API}${data.pngUrl}`)}
            alt={data.name}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.2em' }}>
            [PREVIEW UNAVAILABLE]
          </div>
        )}
        {/* Reticle overlay */}
        <div style={{ position: 'absolute', top: 6, left: 6, fontSize: 8, color: 'var(--accent-primary)', letterSpacing: '0.2em', opacity: 0.7 }}>VIEW · OBLIQUE</div>
        <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 8, color: 'var(--accent-amber)', letterSpacing: '0.2em' }}>RENDER · {durationS}</div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
        <Stat label="STL SIZE" value={sizeKB} />
        <Stat label="FORMAT" value={data.stlPath ? 'STL' : 'PNG ONLY'} />
        <Stat label="STATUS" value="READY" accent="green" />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        {data.stlUrl && (
          <a
            href={withAuthToken(`${API}${data.stlUrl}`)}
            download
            style={{
              ...btnStyle,
              color: 'var(--accent-primary)',
              borderColor: 'rgba(0,229,255,0.4)',
              background: 'rgba(0,229,255,0.08)',
            }}
          >
            ⬇ DOWNLOAD STL
          </a>
        )}
        <a
          href={withAuthToken(`${API}${data.pngUrl}`)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...btnStyle,
            color: 'var(--text-secondary)',
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          OPEN PREVIEW
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' }) {
  const color = accent === 'green' ? 'var(--accent-green)' : accent === 'amber' ? 'var(--accent-amber)' : 'var(--accent-bright)';
  return (
    <div>
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

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 8;
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: size, height: size,
      borderTop: pos.includes('t') ? '2px solid var(--accent-primary)' : undefined,
      borderBottom: pos.includes('b') ? '2px solid var(--accent-primary)' : undefined,
      borderLeft: pos.includes('l') ? '2px solid var(--accent-primary)' : undefined,
      borderRight: pos.includes('r') ? '2px solid var(--accent-primary)' : undefined,
      zIndex: 2,
    }} />
  );
}
