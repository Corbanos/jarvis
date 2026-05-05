'use client';
import { Rnd } from 'react-rnd';
import { type ReactNode } from 'react';
import { useWorkspace, type ModuleInstance } from '@/lib/workspace';

interface FloatingPanelProps {
  module: ModuleInstance;
  title: string;
  accentColor?: string;
  statusDot?: 'green' | 'amber' | 'red' | 'none';
  headerRight?: ReactNode;
  children: ReactNode;
}

export function FloatingPanel({
  module,
  title,
  accentColor = '#00e5ff',
  statusDot = 'none',
  headerRight,
  children,
}: FloatingPanelProps) {
  const focus = useWorkspace((s) => s.focus);
  const close = useWorkspace((s) => s.close);
  const move = useWorkspace((s) => s.move);
  const resize = useWorkspace((s) => s.resize);
  const toggleMinimize = useWorkspace((s) => s.toggleMinimize);

  const dotColor = { green: '#00ff9d', amber: '#ff8c00', red: '#ff3b3b', none: 'transparent' }[statusDot];

  return (
    <Rnd
      size={{ width: module.width, height: module.minimized ? 32 : module.height }}
      position={{ x: module.x, y: module.y }}
      minWidth={220}
      minHeight={module.minimized ? 32 : 180}
      bounds="parent"
      dragHandleClassName="floating-panel-handle"
      onDragStart={() => focus(module.id)}
      onMouseDown={() => focus(module.id)}
      onDragStop={(_, d) => move(module.id, d.x, d.y)}
      onResizeStop={(_, __, ref, ___, position) => {
        resize(module.id, parseInt(ref.style.width, 10), parseInt(ref.style.height, 10));
        move(module.id, position.x, position.y);
      }}
      style={{ zIndex: module.zIndex }}
      enableResizing={!module.minimized}
    >
      <div style={{
        width: '100%',
        height: '100%',
        background: 'rgba(0,4,12,0.92)',
        border: `1px solid ${accentColor}55`,
        boxShadow: `0 0 24px ${accentColor}20, 0 8px 28px rgba(0,0,0,0.6)`,
        backdropFilter: 'blur(10px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderRadius: 3,
      }}>
        {/* Corner brackets */}
        {(['tl','tr','bl','br'] as const).map((p) => <Corner key={p} pos={p} color={accentColor} />)}

        {/* Scan line */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, height: 1,
          background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)`,
          animation: 'scanline 5s linear infinite', pointerEvents: 'none', zIndex: 5,
        }} />

        {/* Header — drag handle */}
        <div className="floating-panel-handle" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: module.minimized ? 'none' : `1px solid ${accentColor}25`,
          background: 'rgba(0,12,28,0.7)',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0,
          height: 32,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {statusDot !== 'none' && (
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: dotColor, boxShadow: `0 0 6px ${dotColor}`,
                animation: 'pulse-glow 2s infinite',
                flexShrink: 0,
              }} />
            )}
            <div style={{ width: 12, height: 1, background: accentColor, opacity: 0.6, flexShrink: 0 }} />
            <span style={{
              fontSize: 9, letterSpacing: '0.25em',
              color: accentColor,
              textTransform: 'uppercase', fontWeight: 700,
              textShadow: `0 0 8px ${accentColor}80`,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {title}
            </span>
          </div>

          {/* Right header content */}
          {headerRight && !module.minimized && (
            <div style={{ marginRight: 12 }}>{headerRight}</div>
          )}

          {/* Window controls */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <WinBtn onClick={(e) => { e.stopPropagation(); toggleMinimize(module.id); }} title={module.minimized ? 'Expand' : 'Minimize'} color="var(--accent-amber)">
              {module.minimized ? '▢' : '_'}
            </WinBtn>
            <WinBtn onClick={(e) => { e.stopPropagation(); close(module.id); }} title="Close" color="var(--accent-red)">✕</WinBtn>
          </div>
        </div>

        {/* Content */}
        {!module.minimized && (
          <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            {/* Subtle grid */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              backgroundImage: `
                linear-gradient(rgba(0,229,255,0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,229,255,0.025) 1px, transparent 1px)
              `,
              backgroundSize: '24px 24px',
              zIndex: 0,
            }} />
            <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
              {children}
            </div>
          </div>
        )}
      </div>
    </Rnd>
  );
}

function WinBtn({ children, onClick, title, color }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; title: string; color: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: `1px solid ${color}50`,
        color,
        width: 18, height: 18,
        fontSize: 10, lineHeight: 1,
        cursor: 'pointer',
        fontFamily: 'inherit',
        borderRadius: 2,
        padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function Corner({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const size = 10;
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: size, height: size,
      borderTop: pos.includes('t') ? `2px solid ${color}` : undefined,
      borderBottom: pos.includes('b') ? `2px solid ${color}` : undefined,
      borderLeft: pos.includes('l') ? `2px solid ${color}` : undefined,
      borderRight: pos.includes('r') ? `2px solid ${color}` : undefined,
      zIndex: 20,
      pointerEvents: 'none',
    }} />
  );
}
