'use client';
import React from 'react';

interface HUDPanelProps {
  title: string;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  statusDot?: 'green' | 'amber' | 'red' | 'none';
  headerRight?: React.ReactNode;
}

export function HUDPanel({ title, children, active = false, className = '', statusDot = 'none', headerRight }: HUDPanelProps) {
  const dotColor = {
    green: 'var(--accent-green)',
    amber: 'var(--accent-amber)',
    red: 'var(--accent-red)',
    none: 'transparent',
  }[statusDot];

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-panel)',
        border: `1px solid ${active ? 'rgba(0,212,255,0.4)' : 'rgba(0,100,150,0.2)'}`,
        boxShadow: active ? '0 0 30px rgba(0,212,255,0.1), inset 0 0 20px rgba(0,200,255,0.02)' : 'var(--panel-shadow)',
        animation: active ? 'pulse-glow 3s ease-in-out infinite' : 'none',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        transition: 'border-color 0.3s ease',
      }}
      className={className}
    >
      {/* Corner brackets */}
      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      {/* Scan line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)',
          animation: 'scanline var(--scan-speed) linear infinite',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid rgba(0,100,150,0.2)',
          background: 'rgba(0,20,50,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {statusDot !== 'none' && (
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor,
                boxShadow: `0 0 6px ${dotColor}`,
                animation: statusDot === 'green' ? 'thinking-pulse 2s ease-in-out infinite' : 'none',
              }}
            />
          )}
          <span
            style={{
              fontSize: 10,
              letterSpacing: '0.2em',
              color: 'var(--accent-primary)',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            {title}
          </span>
        </div>
        {headerRight && <div>{headerRight}</div>}
      </div>

      {/* Content */}
      <div style={{ position: 'relative', height: 'calc(100% - 37px)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 10;
  const t = pos.includes('t') ? 0 : undefined;
  const b = pos.includes('b') ? 0 : undefined;
  const l = pos.includes('l') ? 0 : undefined;
  const r = pos.includes('r') ? 0 : undefined;

  return (
    <div
      style={{
        position: 'absolute',
        top: t,
        bottom: b,
        left: l,
        right: r,
        width: size,
        height: size,
        borderTop: pos.includes('t') ? `2px solid var(--accent-primary)` : undefined,
        borderBottom: pos.includes('b') ? `2px solid var(--accent-primary)` : undefined,
        borderLeft: pos.includes('l') ? `2px solid var(--accent-primary)` : undefined,
        borderRight: pos.includes('r') ? `2px solid var(--accent-primary)` : undefined,
        zIndex: 20,
      }}
    />
  );
}
