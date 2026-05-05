'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore } from '@/lib/store';
import { useAudioLevel } from '@/lib/audio-level';

interface ArcReactorProps {
  size?: number;
}

export function ArcReactor({ size = 300 }: ArcReactorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connected = useJarvisStore((s) => s.connected);

  // Refs that animation loop reads (avoids re-mount on every state change)
  const levelRef = useRef(0);
  const sourceRef = useRef<'silent' | 'user' | 'jarvis'>('silent');
  const connectedRef = useRef(connected);

  useEffect(() => { connectedRef.current = connected; }, [connected]);

  // Subscribe to audio level store and update refs (no re-render)
  useEffect(() => {
    return useAudioLevel.subscribe((s) => {
      levelRef.current = s.level;
      sourceRef.current = s.source;
    });
  }, []);

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
    const baseR = size * 0.35;

    let t = 0;
    let animFrame: number;

    // Ripples emitted on speech onset
    const ripples: Array<{ r: number; alpha: number; color: string }> = [];
    let lastLevel = 0;

    function colorForSource(): { primary: string; bright: string } {
      if (!connectedRef.current) return { primary: '#ff2244', bright: '#ff5577' };
      if (sourceRef.current === 'user') return { primary: '#ff8c00', bright: '#ffaa33' }; // amber for user
      if (sourceRef.current === 'jarvis') return { primary: '#00e5ff', bright: '#88f5ff' }; // bright cyan for Jarvis
      return { primary: '#00b8d4', bright: '#00e5ff' }; // calm cyan when idle
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size);

      const level = levelRef.current;
      const colors = colorForSource();
      const reactive = level * 1.4; // 0..1+
      const pulse = 1 + reactive * 0.18; // scale factor

      // Emit ripples on level rise
      if (level - lastLevel > 0.08 && level > 0.15) {
        ripples.push({ r: baseR * 0.7, alpha: 0.6, color: colors.primary });
      }
      lastLevel = level;

      // Animate ripples outward
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]!;
        rp.r += size * 0.008;
        rp.alpha *= 0.94;
        if (rp.alpha < 0.02 || rp.r > size * 0.55) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
        ctx.strokeStyle = rp.color;
        ctx.globalAlpha = rp.alpha;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Outer aura — grows with audio level
      const auraR = baseR * 1.4 + reactive * size * 0.08;
      const auraGrd = ctx.createRadialGradient(cx, cy, baseR, cx, cy, auraR);
      auraGrd.addColorStop(0, `${colors.primary}${alphaHex(0.15 + reactive * 0.3)}`);
      auraGrd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
      ctx.fillStyle = auraGrd;
      ctx.fill();

      // Concentric rings (scaled by pulse)
      const rings = [1.0, 0.85, 0.7, 0.55, 0.42, 0.3, 0.15];
      rings.forEach((rRatio, i) => {
        const r = baseR * rRatio * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = i < 3 ? colors.primary : `${colors.primary}66`;
        ctx.lineWidth = i === 0 ? 2 : i < 3 ? 1.2 : 0.6;
        ctx.globalAlpha = 0.4 + Math.sin(t * 1.2 + i * 0.7) * 0.15 + reactive * 0.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Tick marks (24 around perimeter)
      const tickR = baseR * 0.98 * pulse;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const isMajor = i % 6 === 0;
        const r1 = tickR;
        const r2 = isMajor ? tickR - size * 0.04 : tickR - size * 0.02;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = isMajor ? 1.6 : 0.7;
        ctx.globalAlpha = 0.5 + reactive * 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Rotating arc 1 — speed scales with audio
      const speed1 = 0.6 + reactive * 1.2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * speed1);
      ctx.beginPath();
      ctx.arc(0, 0, baseR * 0.92 * pulse, 0, Math.PI * 1.3);
      ctx.strokeStyle = colors.bright;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7 + reactive * 0.3;
      ctx.stroke();
      ctx.restore();

      // Rotating arc 2 (reverse)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * (0.4 + reactive * 0.8));
      ctx.beginPath();
      ctx.arc(0, 0, baseR * 0.78 * pulse, Math.PI * 0.3, Math.PI * 1.85);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.5 + reactive * 0.3;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      // Petals — small triangular accents (Iron Man reactor signature)
      const petalCount = 9;
      for (let i = 0; i < petalCount; i++) {
        const a = (i / petalCount) * Math.PI * 2 + t * 0.1;
        const pr = baseR * 0.5 * pulse;
        const pa = baseR * 0.04 + reactive * size * 0.005;
        const px = cx + Math.cos(a) * pr;
        const py = cy + Math.sin(a) * pr;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -pa * 1.5);
        ctx.lineTo(pa, pa);
        ctx.lineTo(-pa, pa);
        ctx.closePath();
        ctx.fillStyle = colors.bright;
        ctx.globalAlpha = 0.7 + reactive * 0.3;
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // Inner core glow — biggest reaction here
      const coreR = baseR * 0.22 + reactive * size * 0.04;
      const coreGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2);
      coreGrd.addColorStop(0, '#ffffff');
      coreGrd.addColorStop(0.3, colors.bright);
      coreGrd.addColorStop(0.7, `${colors.primary}88`);
      coreGrd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 2, 0, Math.PI * 2);
      ctx.fillStyle = coreGrd;
      ctx.globalAlpha = 0.85 + Math.sin(t * 4) * 0.08 + reactive * 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Hard center dot
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.07 + reactive * 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9 + reactive * 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;

      t += 0.025;
      animFrame = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [size]);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
    </div>
  );
}

function alphaHex(a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return v.toString(16).padStart(2, '0');
}
