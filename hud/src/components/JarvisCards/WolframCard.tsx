'use client';
import { useState } from 'react';

export interface WolframImage { src: string; alt: string; width: number; height: number }
export interface WolframSubpod { plaintext: string; image?: WolframImage }
export interface WolframPod { id: string; title: string; primary: boolean; subpods: WolframSubpod[] }
export interface WolframResult {
  input: string;
  success: boolean;
  interpretation?: string;
  primary?: string;
  pods: WolframPod[];
  assumptions: string[];
  didYouMean: string[];
  error?: string;
  timing?: number;
}

const INITIAL_PODS = 4;

export function WolframCard({ data }: { data: WolframResult }) {
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;

  // Input interpretation and the primary result get their own treatment;
  // everything else is a pod in the list.
  const rest = (data.pods ?? []).filter((p) => !/^input/i.test(p.title) && !p.primary);
  const visible = expanded ? rest : rest.slice(0, INITIAL_PODS);
  const hidden = rest.length - visible.length;
  const primaryPod = data.pods?.find((p) => p.primary);

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(20,8,0,0.95) 0%, rgba(8,4,0,0.95) 100%)',
      border: '1px solid rgba(255,140,0,0.35)',
      borderRadius: 4,
      overflow: 'hidden',
      maxWidth: '100%',
      boxShadow: '0 0 24px rgba(255,140,0,0.08), inset 0 0 30px rgba(255,140,0,0.02)',
    }}>
      <div style={{
        padding: '8px 14px',
        background: 'rgba(60,25,0,0.45)',
        borderBottom: '1px solid rgba(255,140,0,0.2)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--accent-amber)', letterSpacing: '-0.05em' }}>W|A</span>
        <span style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-amber)', fontWeight: 700 }}>WOLFRAM|ALPHA</span>
        {data.interpretation && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.interpretation}>
            {data.interpretation}
          </span>
        )}
      </div>

      {!data.success && (
        <div style={{ padding: '14px 16px', fontSize: 11, color: 'var(--accent-amber)', lineHeight: 1.6 }}>
          {data.error ?? 'No result.'}
        </div>
      )}

      {data.success && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(data.primary || primaryPod) && (
            <div>
              <div style={{ fontSize: 8, letterSpacing: '0.25em', color: 'var(--text-dim)', marginBottom: 4 }}>
                {(primaryPod?.title ?? 'RESULT').toUpperCase()}
              </div>
              {data.primary && (
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-bright)', textShadow: '0 0 12px rgba(255,140,0,0.35)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
                  {data.primary}
                </div>
              )}
              {primaryPod?.subpods.map((s, i) => s.image && !isTextOnlyImage(s) && <PodImage key={i} image={s.image} />)}
            </div>
          )}

          {visible.map((pod) => <Pod key={pod.id} pod={pod} />)}

          {hidden > 0 && (
            <button onClick={() => setExpanded(true)} style={moreBtn}>▾ SHOW {hidden} MORE</button>
          )}
          {expanded && rest.length > INITIAL_PODS && (
            <button onClick={() => setExpanded(false)} style={moreBtn}>▴ SHOW LESS</button>
          )}

          {(data.assumptions.length > 0 || data.didYouMean.length > 0) && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.6, borderTop: '1px solid rgba(255,140,0,0.12)', paddingTop: 8 }}>
              {data.assumptions.map((a, i) => <div key={`a${i}`}>◦ {a}</div>)}
              {data.didYouMean.length > 0 && <div>◦ Did you mean: {data.didYouMean.join(', ')}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A pod image whose whole content is already in plaintext adds nothing but height. */
function isTextOnlyImage(s: WolframSubpod): boolean {
  return !!s.plaintext && !!s.image && s.image.height < 40;
}

function Pod({ pod }: { pod: WolframPod }) {
  return (
    <div>
      <div style={{ fontSize: 8, letterSpacing: '0.25em', color: 'var(--accent-amber)', marginBottom: 4, opacity: 0.85 }}>
        {pod.title.toUpperCase()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pod.subpods.map((s, i) => (
          <div key={i}>
            {s.image && !isTextOnlyImage(s)
              ? <PodImage image={s.image} />
              : s.plaintext && (
                <div style={{ fontSize: 11, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
                  {s.plaintext}
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PodImage({ image }: { image: WolframImage }) {
  return (
    <img
      src={image.src}
      alt={image.alt}
      width={image.width || undefined}
      height={image.height || undefined}
      style={{
        maxWidth: '100%', height: 'auto', display: 'block',
        borderRadius: 3,
        // Wolfram renders black-on-white; inverting with a hue rotation keeps
        // plot colours roughly right while putting it on the HUD's dark ground.
        filter: 'invert(0.92) hue-rotate(180deg)',
        opacity: 0.95,
      }}
    />
  );
}

const moreBtn: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: '1px solid rgba(255,140,0,0.3)',
  borderRadius: 3,
  color: 'var(--accent-amber)',
  padding: '4px 10px',
  fontSize: 9,
  letterSpacing: '0.2em',
  fontFamily: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
};
