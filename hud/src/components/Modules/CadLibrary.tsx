'use client';
import { useEffect, useState } from 'react';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

interface CadJob {
  name: string;
  mtime: number;
  previewUrl: string | null;
  stlUrl: string | null;
  scadUrl: string | null;
}

export function CadLibrary() {
  const [jobs, setJobs] = useState<CadJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    fetch(`${API}/api/cad/list`).then((r) => r.json()).then((d: CadJob[]) => {
      setJobs(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em' }}>LOADING…</div>;

  if (!jobs.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>◈</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>NO CAD DESIGNS YET</div>
        <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7 }}>
          Ask Jarvis to design something
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, alignContent: 'start' }}>
      {jobs.map((j) => <CadThumb key={j.name} job={j} />)}
    </div>
  );
}

function CadThumb({ job }: { job: CadJob }) {
  const date = new Date(job.mtime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const displayName = job.name.replace(/-\d{4}-\d{2}-\d{2}T.*$/, '');

  return (
    <div style={{
      background: 'rgba(0,12,24,0.6)',
      border: '1px solid rgba(0,229,255,0.15)',
      borderRadius: 3,
      padding: 6,
      transition: 'all 0.15s',
    }}>
      <div style={{
        background: 'rgba(0,4,12,0.8)',
        border: '1px solid rgba(0,229,255,0.1)',
        borderRadius: 2,
        aspectRatio: '4/3',
        marginBottom: 5,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {job.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API}${job.previewUrl}`} alt={job.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-dim)' }}>—</div>
        )}
      </div>
      <div style={{ fontSize: 9, color: 'var(--accent-bright)', fontWeight: 700, letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
      </div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 2 }}>
        {date}
      </div>
      {job.stlUrl && (
        <a
          href={`${API}${job.stlUrl}`}
          download
          style={{
            display: 'block', marginTop: 4,
            background: 'rgba(0,229,255,0.06)',
            border: '1px solid rgba(0,229,255,0.25)',
            borderRadius: 2,
            color: 'var(--accent-primary)',
            fontSize: 8, letterSpacing: '0.15em',
            padding: '3px 6px',
            textAlign: 'center',
            textDecoration: 'none',
            fontWeight: 700,
          }}
        >
          ⬇ STL
        </a>
      )}
    </div>
  );
}
