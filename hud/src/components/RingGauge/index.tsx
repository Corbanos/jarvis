'use client';
import { useEffect, useRef } from 'react';

interface RingGaugeProps {
  label: string;
  value: number; // 0-100
  size?: number;
  color?: string;
  subLabel?: string;
}

export function RingGauge({ label, value, size = 80, color = '#00e5ff', subLabel }: RingGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.38;
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const fillAngle = startAngle + (endAngle - startAngle) * (value / 100);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(0,150,200,0.15)';
    ctx.lineWidth = size * 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Tick marks
    const ticks = 20;
    for (let i = 0; i <= ticks; i++) {
      const a = startAngle + (endAngle - startAngle) * (i / ticks);
      const rOuter = r + size * 0.12;
      const rInner = rOuter - (i % 5 === 0 ? size * 0.06 : size * 0.03);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rOuter, cy + Math.sin(a) * rOuter);
      ctx.lineTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
      ctx.strokeStyle = i % 5 === 0 ? color + 'aa' : color + '44';
      ctx.lineWidth = i % 5 === 0 ? 1.5 : 0.7;
      ctx.stroke();
    }

    // Value arc (glow effect — draw twice)
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, fillAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = pass === 0 ? size * 0.12 : size * 0.06;
      ctx.globalAlpha = pass === 0 ? 0.15 : 1;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    ctx.strokeStyle = color + '22';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Label
    ctx.fillStyle = color;
    ctx.font = `bold ${size * 0.22}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(value)}%`, cx, cy);

    ctx.fillStyle = color + 'aa';
    ctx.font = `${size * 0.11}px monospace`;
    ctx.fillText(label, cx, cy + size * 0.18);

    if (subLabel) {
      ctx.fillStyle = color + '66';
      ctx.font = `${size * 0.10}px monospace`;
      ctx.fillText(subLabel, cx, cy - size * 0.18);
    }
  }, [label, value, size, color, subLabel]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}
