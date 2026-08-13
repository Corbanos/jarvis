'use client';
import { parseJarvisResponse, type Segment } from './parser';
import { WeatherCard } from './WeatherCard';
import { CadCard } from './CadCard';
import { PrinterCard } from './PrinterCard';

export { parseJarvisResponse, stripCards } from './parser';

/**
 * Jarvis writes ordinary markdown emphasis, so render it instead of printing
 * the literal asterisks. Deliberately inline-only (bold / italic / code) —
 * block markdown is what <jarvis-card> is for. The set handled here mirrors
 * what useJarvisTTS strips before speaking, so the eyes and the ears agree.
 *
 * ** before * in the alternation, otherwise '**x**' matches as italic-'*x*'.
 */
const INLINE_MD = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(INLINE_MD);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i} style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
        }
        if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} style={{
              fontFamily: 'inherit',
              background: 'rgba(0,229,255,0.08)',
              border: '1px solid rgba(0,229,255,0.2)',
              borderRadius: 2,
              padding: '0 4px',
              color: 'var(--accent-primary)',
            }}>{p.slice(1, -1)}</code>
          );
        }
        if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) {
          return <em key={i} style={{ color: 'var(--accent-amber)' }}>{p.slice(1, -1)}</em>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function JarvisRichResponse({ text }: { text: string }) {
  const segments = parseJarvisResponse(text);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {segments.map((seg, i) => <SegmentRender key={i} seg={seg} />)}
    </div>
  );
}

function SegmentRender({ seg }: { seg: Segment }) {
  if (seg.kind === 'text') {
    return (
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, fontSize: 12 }}>
        <InlineMarkdown text={seg.text} />
      </div>
    );
  }

  // Render the right card type
  switch (seg.cardType) {
    case 'weather':
      return <WeatherCard data={seg.data as Parameters<typeof WeatherCard>[0]['data']} />;
    case 'cad':
      return <CadCard data={seg.data as Parameters<typeof CadCard>[0]['data']} />;
    case 'printer':
      return <PrinterCard data={seg.data as Parameters<typeof PrinterCard>[0]['data']} />;
    case 'stat':
      return <StatCard data={seg.data as { label: string; value: string; unit?: string; color?: string }} />;
    case 'list':
      return <ListCard data={seg.data as { title: string; items: Array<{ label: string; value: string }> }} />;
    case 'code':
      return <CodeCard data={seg.data as { language?: string; code: string }} />;
    default:
      return (
        <div style={{ padding: 10, border: '1px dashed rgba(255,140,0,0.4)', borderRadius: 3, fontSize: 10, color: 'var(--accent-amber)' }}>
          Unknown card type: {seg.cardType}
        </div>
      );
  }
}

function StatCard({ data }: { data: { label: string; value: string; unit?: string; color?: string } }) {
  const colorMap: Record<string, string> = {
    cyan: 'var(--accent-primary)',
    amber: 'var(--accent-amber)',
    green: 'var(--accent-green)',
    red: 'var(--accent-red)',
  };
  const color = colorMap[data.color ?? 'cyan'] ?? 'var(--accent-primary)';

  return (
    <div style={{
      background: 'rgba(0,15,30,0.9)',
      border: `1px solid ${color}50`,
      borderRadius: 4, padding: '14px 18px',
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
      boxShadow: `0 0 16px ${color}15`,
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.25em' }}>{data.label?.toUpperCase()}</span>
      <span style={{ fontSize: 22, color, fontWeight: 800, textShadow: `0 0 12px ${color}80` }}>
        {data.value}
        {data.unit && <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--text-secondary)' }}>{data.unit}</span>}
      </span>
    </div>
  );
}

function ListCard({ data }: { data: { title: string; items: Array<{ label: string; value: string }> } }) {
  return (
    <div style={{
      background: 'rgba(0,15,30,0.9)',
      border: '1px solid rgba(0,229,255,0.2)',
      borderRadius: 4, overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 14px', background: 'rgba(0,30,60,0.5)', borderBottom: '1px solid rgba(0,229,255,0.15)', fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700 }}>
        {data.title?.toUpperCase()}
      </div>
      <div style={{ padding: '8px 0' }}>
        {data.items?.map((item, i) => (
          <div key={i} style={{ padding: '5px 14px', display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: i < data.items.length - 1 ? '1px solid rgba(0,229,255,0.05)' : 'none' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
            <span style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeCard({ data }: { data: { language?: string; code: string } }) {
  return (
    <div style={{ background: 'rgba(0,8,16,0.95)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ padding: '5px 12px', background: 'rgba(0,30,60,0.5)', fontSize: 8, letterSpacing: '0.2em', color: 'var(--accent-primary)' }}>
        {(data.language ?? 'CODE').toUpperCase()}
      </div>
      <pre style={{ margin: 0, padding: 12, fontSize: 11, color: 'var(--accent-bright)', fontFamily: 'inherit', overflow: 'auto', maxHeight: 300, lineHeight: 1.5 }}>
        {data.code}
      </pre>
    </div>
  );
}
