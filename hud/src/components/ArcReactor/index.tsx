'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';

export function ArcReactor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connected = useJarvisStore((s) => s.connected);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 180;
    const H = 180;
    canvas.width = W;
    canvas.height = H;
    const cx = W / 2;
    const cy = H / 2;
    let t = 0;
    let animFrame: number;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const color = connected ? '#00e5ff' : '#ff2244';
      const dimColor = connected ? 'rgba(0,229,255,0.15)' : 'rgba(255,34,68,0.15)';

      // Outer rings
      const rings = [72, 60, 48, 36, 22, 10];
      rings.forEach((r, i) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i < 2 ? color : dimColor;
        ctx.lineWidth = i < 2 ? 1 : 0.5;
        ctx.globalAlpha = 0.4 + Math.sin(t * 1.5 + i) * 0.15;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Rotating arc 1
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.8);
      ctx.beginPath();
      ctx.arc(0, 0, 66, 0, Math.PI * 1.4);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // Rotating arc 2 (reverse)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 56, Math.PI * 0.3, Math.PI * 1.8);
      ctx.strokeStyle = connected ? '#00ffff' : '#ff4466';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // Tick marks on outer ring
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r1 = 70;
        const r2 = i % 6 === 0 ? 62 : 67;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.strokeStyle = color;
        ctx.lineWidth = i % 6 === 0 ? 1.5 : 0.5;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Center glow
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      grd.addColorStop(0, connected ? 'rgba(0,255,255,0.9)' : 'rgba(255,50,80,0.9)');
      grd.addColorStop(0.4, connected ? 'rgba(0,200,255,0.4)' : 'rgba(255,30,60,0.4)');
      grd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = connected ? '#ffffff' : '#ff8899';
      ctx.globalAlpha = 0.9 + Math.sin(t * 3) * 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Outer glow pulse
      const outerGrd = ctx.createRadialGradient(cx, cy, 60, cx, cy, 90);
      outerGrd.addColorStop(0, `rgba(0,229,255,${0.05 + Math.sin(t * 2) * 0.03})`);
      outerGrd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, 90, 0, Math.PI * 2);
      ctx.fillStyle = outerGrd;
      ctx.fill();

      t += 0.025;
      animFrame = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [connected]);

  return (
    <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ width: 180, height: 180 }} />
      <div style={{
        position: 'absolute',
        bottom: -18,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 9,
        letterSpacing: '0.3em',
        color: 'var(--accent-primary)',
        whiteSpace: 'nowrap',
        textShadow: 'var(--glow-soft)',
      }}
        className="text-flicker"
      >
        J.A.R.V.I.S.
      </div>
    </div>
  );
}
