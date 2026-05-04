'use client';
import { useEffect, useRef } from 'react';

export function HexGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame: number;
    let t = 0;

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function hexPath(cx: number, cy: number, r: number) {
      ctx!.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        if (i === 0) ctx!.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        else ctx!.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx!.closePath();
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const r = 26;
      const cols = Math.ceil(canvas.width / (r * 1.73)) + 2;
      const rows = Math.ceil(canvas.height / (r * 1.5)) + 2;

      for (let col = -1; col < cols; col++) {
        for (let row = -1; row < rows; row++) {
          const x = col * r * 1.73;
          const y = row * r * 1.5 + (col % 2 === 0 ? 0 : r * 0.75);
          const dx = x - canvas.width * 0.5;
          const dy = y - canvas.height * 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const wave = Math.sin(dist * 0.012 - t * 0.6) * 0.5 + 0.5;
          const alpha = wave * 0.07 + 0.015;

          hexPath(x, y, r - 1.5);
          ctx.strokeStyle = `rgba(0, 220, 255, ${alpha})`;
          ctx.lineWidth = 0.4;
          ctx.stroke();

          // Occasional brighter hex
          if (Math.sin(col * 7.3 + row * 3.7 + t * 0.1) > 0.97) {
            hexPath(x, y, r - 1.5);
            ctx.strokeStyle = `rgba(0, 229, 255, 0.25)`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      t += 0.012;
      animFrame = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  );
}
