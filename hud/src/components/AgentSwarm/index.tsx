'use client';
import { useEffect, useRef } from 'react';
import { useJarvisStore, type AgentRecord } from '@/lib/store';

export function AgentSwarm() {
  const agents = useJarvisStore((s) => s.agents);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    const cx = W / 2;
    const cy = H / 2;

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, W, H);

      // Draw center node (JARVIS)
      drawNode(ctx, cx, cy, 'JARVIS', 'running', 18);

      // Draw agent nodes in a circle
      const active = agents.slice(-8); // max 8 visible
      active.forEach((agent, i) => {
        const angle = (i / Math.max(active.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const r = Math.min(W, H) * 0.3;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        // Line from center to node
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = agent.status === 'running'
          ? 'rgba(0,212,255,0.3)'
          : agent.status === 'complete'
          ? 'rgba(0,255,136,0.2)'
          : 'rgba(255,59,59,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        drawNode(ctx, x, y, `A-${agent.id.slice(0, 4).toUpperCase()}`, agent.status, 10);
      });

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [agents]);

  return (
    <div style={{ height: '100%', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', flex: 1, display: 'block' }}
      />
      {agents.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em', pointerEvents: 'none' }}>
          NO ACTIVE AGENTS
        </div>
      )}
      {/* Agent list */}
      <div style={{ overflowY: 'auto', maxHeight: 80, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {agents.slice(-5).reverse().map((a) => (
          <AgentRow key={a.id} agent={a} />
        ))}
      </div>
    </div>
  );
}

function drawNode(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, status: string, r: number) {
  const color = status === 'running' || status === 'spawning'
    ? '#00d4ff'
    : status === 'complete'
    ? '#00ff88'
    : '#ff3b3b';

  // Glow
  const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
  grd.addColorStop(0, color + '40');
  grd.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Circle
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,10,25,0.8)';
  ctx.fill();

  // Label
  ctx.fillStyle = color;
  ctx.font = `${Math.max(r * 0.6, 8)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

function AgentRow({ agent }: { agent: AgentRecord }) {
  const color = agent.status === 'running' ? 'var(--accent-primary)'
    : agent.status === 'complete' ? 'var(--accent-green)'
    : agent.status === 'failed' ? 'var(--accent-red)'
    : 'var(--accent-amber)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, letterSpacing: '0.08em' }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {agent.goal.slice(0, 40)}
      </span>
      <span style={{ color, flexShrink: 0 }}>{agent.status.toUpperCase()}</span>
    </div>
  );
}
