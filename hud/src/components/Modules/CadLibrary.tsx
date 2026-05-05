'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { authFetch, withAuthToken } from '@/lib/auth';

const API = process.env['NEXT_PUBLIC_JARVIS_API'] ?? 'http://localhost:7777';

// Dynamically import STLViewer (client-only, uses WebGL)
const STLViewer = dynamic(() => import('./STLViewer').then((m) => m.STLViewer), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.2em' }}>
      LOADING 3D VIEWER…
    </div>
  ),
});

// Mini version of STLViewer for thumbnails - auto-rotates and is non-interactive
const MiniSTLViewer = dynamic(() => import('./MiniSTLViewer').then((m) => m.MiniSTLViewer), {
  ssr: false,
  loading: () => null,
});

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
  const [selectedJob, setSelectedJob] = useState<CadJob | null>(null);

  const refresh = () => {
    authFetch(`${API}/api/cad/list`).then((r) => r.json()).then((d: CadJob[]) => {
      setJobs(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const handleClose = useCallback(() => setSelectedJob(null), []);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedJob) {
        setSelectedJob(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedJob]);

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
    <>
      <div style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, alignContent: 'start' }}>
        {jobs.map((j) => <CadThumb key={j.name} job={j} onSelect={setSelectedJob} />)}
      </div>
      
      {/* 3D Viewer Modal */}
      {selectedJob && (
        <STLViewerModal job={selectedJob} onClose={handleClose} />
      )}
    </>
  );
}

function CadThumb({ job, onSelect }: { job: CadJob; onSelect: (job: CadJob) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMini3D, setShowMini3D] = useState(false);
  const date = new Date(job.mtime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const displayName = job.name.replace(/-\d{4}-\d{2}-\d{2}T.*$/, '');
  const hasSTL = !!job.stlUrl;

  // Delay loading the mini 3D viewer to save resources
  useEffect(() => {
    if (hasSTL && isHovered) {
      const timer = setTimeout(() => setShowMini3D(true), 200);
      return () => clearTimeout(timer);
    }
  }, [hasSTL, isHovered]);

  return (
    <div style={{
      background: 'rgba(0,12,24,0.6)',
      border: '1px solid rgba(0,229,255,0.15)',
      borderRadius: 3,
      padding: 6,
      transition: 'all 0.15s',
    }}>
      {/* Clickable Preview Area */}
      <div
        onClick={() => onSelect(job)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          background: 'rgba(0,4,12,0.8)',
          border: `1px solid ${isHovered ? 'rgba(0,229,255,0.5)' : 'rgba(0,229,255,0.1)'}`,
          borderRadius: 2,
          aspectRatio: '4/3',
          marginBottom: 5,
          overflow: 'hidden',
          position: 'relative',
          cursor: 'pointer',
          transition: 'all 0.2s',
          boxShadow: isHovered ? '0 0 12px rgba(0,229,255,0.2)' : 'none',
        }}
      >
        {/* Show mini 3D viewer on hover if STL available, otherwise show image */}
        {hasSTL && showMini3D && isHovered ? (
          <div style={{ position: 'absolute', inset: 0 }}>
            <MiniSTLViewer url={withAuthToken(`${API}${job.stlUrl}`)} />
          </div>
        ) : job.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withAuthToken(`${API}${job.previewUrl}`)} alt={job.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-dim)' }}>—</div>
        )}
        
        {/* 3D indicator badge */}
        {hasSTL && (
          <div style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'rgba(0,229,255,0.9)',
            color: '#000',
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: '0.1em',
            padding: '2px 4px',
            borderRadius: 2,
            zIndex: 10,
          }}>
            3D
          </div>
        )}
        
        {/* Hover overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: hasSTL && showMini3D && isHovered ? 'transparent' : 'rgba(0,229,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s',
          pointerEvents: 'none',
        }}>
          {!(hasSTL && showMini3D && isHovered) && (
            <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--accent-primary)', fontWeight: 700 }}>
              {hasSTL ? 'CLICK FOR 3D' : 'VIEW'}
            </span>
          )}
        </div>
      </div>
      
      <div style={{ fontSize: 9, color: 'var(--accent-bright)', fontWeight: 700, letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
      </div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 2 }}>
        {date}
      </div>
      {job.stlUrl && (
        <a
          href={withAuthToken(`${API}${job.stlUrl}`)}
          download
          onClick={(e) => e.stopPropagation()}
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

function STLViewerModal({ job, onClose }: { job: CadJob; onClose: () => void }) {
  const displayName = job.name.replace(/-\d{4}-\d{2}-\d{2}T.*$/, '');
  const hasSTL = !!job.stlUrl;
  const date = new Date(job.mtime).toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: 'numeric', 
    minute: '2-digit' 
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 4, 12, 0.92)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90vw',
          maxWidth: 900,
          height: '80vh',
          maxHeight: 700,
          background: 'rgba(0, 8, 20, 0.95)',
          border: '1px solid rgba(0, 229, 255, 0.3)',
          borderRadius: 6,
          boxShadow: '0 0 40px rgba(0, 229, 255, 0.15), inset 0 0 60px rgba(0, 229, 255, 0.02)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(0, 229, 255, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--accent-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.15em', marginTop: 2 }}>
              {date}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {job.stlUrl && (
              <a
                href={withAuthToken(`${API}${job.stlUrl}`)}
                download
                style={{
                  padding: '6px 12px',
                  background: 'rgba(0, 229, 255, 0.1)',
                  border: '1px solid rgba(0, 229, 255, 0.4)',
                  borderRadius: 3,
                  color: 'var(--accent-primary)',
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
              >
                ⬇ DOWNLOAD STL
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                background: 'rgba(255, 85, 119, 0.1)',
                border: '1px solid rgba(255, 85, 119, 0.4)',
                borderRadius: 3,
                color: 'var(--accent-red)',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* 3D Viewer Area */}
        <div style={{
          flex: 1,
          position: 'relative',
          background: 'rgba(0, 4, 12, 0.9)',
        }}>
          {/* Corner decorations */}
          <div style={{ position: 'absolute', top: 8, left: 10, fontSize: 8, color: 'var(--accent-primary)', letterSpacing: '0.2em', opacity: 0.8, zIndex: 5 }}>
            {hasSTL ? 'INTERACTIVE 3D · DRAG TO ROTATE' : 'STATIC PREVIEW'}
          </div>
          <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 8, color: 'var(--accent-amber)', letterSpacing: '0.2em', zIndex: 5 }}>
            {hasSTL ? 'WebGL' : 'PNG'}
          </div>
          <div style={{ position: 'absolute', bottom: 8, left: 10, fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.2em', zIndex: 5 }}>
            {hasSTL ? 'SCROLL · ZOOM   ·   RIGHT-DRAG · PAN' : ''}
          </div>
          <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 8, color: 'var(--accent-green)', letterSpacing: '0.2em', zIndex: 5 }}>
            ● READY
          </div>

          {/* Viewer content */}
          {hasSTL ? (
            <div style={{ position: 'absolute', inset: 0 }}>
              <STLViewer url={withAuthToken(`${API}${job.stlUrl}`)} />
            </div>
          ) : job.previewUrl ? (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              padding: 20,
            }}>
              {/* Crosshair decoration for static view */}
              <div style={{ position: 'absolute', top: '50%', left: '50%', width: 80, height: 80, transform: 'translate(-50%, -50%)', pointerEvents: 'none', opacity: 0.15 }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--accent-primary)' }} />
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--accent-primary)' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 18, height: 18, border: '1px solid var(--accent-primary)', borderRadius: '50%' }} />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={withAuthToken(`${API}${job.previewUrl}`)}
                alt={displayName}
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '100%', 
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 0 20px rgba(0, 229, 255, 0.25))',
                }}
              />
            </div>
          ) : (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-dim)',
              fontSize: 11,
              letterSpacing: '0.2em',
            }}>
              NO PREVIEW AVAILABLE
            </div>
          )}
        </div>

        {/* Footer with instructions */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(0, 229, 255, 0.15)',
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          flexShrink: 0,
        }}>
          {hasSTL ? (
            <>
              <Instruction icon="↻" text="Left-drag to rotate" />
              <Instruction icon="⇕" text="Scroll to zoom" />
              <Instruction icon="⇔" text="Right-drag to pan" />
              <Instruction icon="Esc" text="Close" />
            </>
          ) : (
            <Instruction icon="Esc" text="Press to close" />
          )}
        </div>
      </div>
    </div>
  );
}

function Instruction({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        background: 'rgba(0, 229, 255, 0.1)',
        border: '1px solid rgba(0, 229, 255, 0.3)',
        borderRadius: 3,
        padding: '2px 6px',
        fontSize: 10,
        color: 'var(--accent-primary)',
        fontWeight: 700,
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
        {text}
      </span>
    </div>
  );
}
