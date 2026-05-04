'use client';
import React from 'react';

interface HUDPanelProps {
  title: string;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
  statusDot?: 'green' | 'amber' | 'red' | 'none';
  headerRight?: React.ReactNode;
  accentColor?: string;
}

export function HUDPanel({
  title, children, active = false, className = '', style,
  statusDot = 'none', headerRight, accentColor = '#00e5ff',
}: HUDPanelProps) {
  const dotColor = { green: '#00ff9d', amber: '#ff8c00', red: '#ff2244', none: 'transparent' }[statusDot];
  const borderColor = active ? `${accentColor}55` : 'rgba(0,180,220,0.12)';

  return (
    <div
      style={{
        position: 'relative',
        background: 'rgba(0,4,12,0.92)',
        border: `1px solid ${borderColor}`,
        boxShadow: active
          ? `0 0 20px ${accentColor}18, inset 0 0 30px ${accentColor}06`
          : '0 0 20px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        overflow: 'hidden',
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
        ...style,
      }}
      className={className}
    >
      {/* Corner brackets */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
        <CornerBracket key={pos} pos={pos} color={accentColor} />
      ))}

      {/* Scan line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '1px',
        background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)`,
        animation: 'scanline 5s linear infinite',
        pointerEvents: 'none', zIndex: 10,
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 14px',
        borderBottom: `1px solid ${accentColor}18`,
        background: 'rgba(0,10,25,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {statusDot !== 'none' && (
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 6px ${dotColor}`,
              animation: 'pulse-glow 2s infinite',
            }} />
          )}
          {/* Left decorative line */}
          <div style={{ width: 12, height: 1, background: accentColor, opacity: 0.6 }} />
          <span style={{
            fontSize: 9, letterSpacing: '0.25em', color: accentColor,
            textTransform: 'uppercase', fontWeight: 700,
            textShadow: `0 0 8px ${accentColor}80`,
          }}>
            {title}
          </span>
          <div style={{ width: 8, height: 1, background: accentColor, opacity: 0.3 }} />
        </div>
        {headerRight && (
          <div style={{ fontSize: 8, color: 'rgba(0,229,255,0.4)', letterSpacing: '0.1em' }}>
            {headerRight}
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ position: 'relative', height: 'calc(100% - 32px)', overflow: 'hidden' }}>
        {/* Subtle grid overlay */}
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
    </div>
  );
}

const BRACKET_SIZE = 12;

function CornerBracket({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: BRACKET_SIZE,
      height: BRACKET_SIZE,
      borderTop: pos.includes('t') ? `2px solid ${color}` : undefined,
      borderBottom: pos.includes('b') ? `2px solid ${color}` : undefined,
      borderLeft: pos.includes('l') ? `2px solid ${color}` : undefined,
      borderRight: pos.includes('r') ? `2px solid ${color}` : undefined,
      zIndex: 20,
    }} />
  );
}
