'use client';
/**
 * BROWSER — live view of Jarvis's own Playwright/Chromium page.
 *
 * Frames arrive as base64 JPEG over /ws/browser (CDP screencast on the
 * server). They're decoded with createImageBitmap and painted to a canvas,
 * letterboxed to preserve the 1280x800 viewport aspect. A cyan reticle tracks
 * the virtual cursor Jarvis's automation moves around, with a ring pulse on
 * click.
 *
 * Frame data is treated strictly as image bytes — nothing from the page is
 * ever evaluated here.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { computeBrowserWsUrl } from '@/lib/ws-url';

type ConnState = 'connecting' | 'live' | 'idle' | 'nosession' | 'offline';

interface CursorMsg { x: number; y: number; click: boolean }

interface FrameMsg {
  type: 'frame';
  data: string;
  width: number;
  height: number;
  ts: number;
  cursor?: CursorMsg;
}

interface StateMsg {
  type: 'state';
  session: boolean;
  url: string;
  title: string;
  viewport?: { width: number; height: number };
}

const DOT: Record<ConnState, { color: string; label: string }> = {
  connecting: { color: '#ff8c00', label: 'LINKING' },
  live:       { color: '#00ff9d', label: 'LIVE' },
  idle:       { color: '#00e5ff', label: 'IDLE' },
  nosession:  { color: '#6a7a86', label: 'NO SESSION' },
  offline:    { color: '#ff3b3b', label: 'OFFLINE' },
};

export function BrowserModule() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame pipeline (refs — never re-render per frame)
  const pendingRef = useRef<string | null>(null);
  const decodingRef = useRef(false);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const frameSizeRef = useRef({ w: 1280, h: 800 });
  const lastFrameAtRef = useRef(0);
  const rectRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const framesRef = useRef(0);

  const [conn, setConn] = useState<ConnState>('connecting');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const viewportRef = useRef({ width: 1280, height: 800 });
  const cursorRef = useRef<CursorMsg>({ x: 640, y: 400, click: false });
  const overlayRef = useRef<HTMLDivElement>(null);
  const [pulse, setPulse] = useState(0);
  const [control, setControl] = useState(false);
  const [fps, setFps] = useState(0);
  const clickRef = useRef(false);

  const controlRef = useRef(false);
  controlRef.current = control;
  const lastMoveSentRef = useRef(0);

  const sendMsg = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  // ── decode + paint ──────────────────────────────────────────────
  const decodeNext = useCallback(() => {
    if (decodingRef.current) return;
    const b64 = pendingRef.current;
    if (!b64) return;
    pendingRef.current = null;
    decodingRef.current = true;

    // base64 → bytes → Blob → ImageBitmap (off the main thread)
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      createImageBitmap(blob)
        .then((bmp) => {
          if (!mountedRef.current) { bmp.close(); return; }
          bitmapRef.current?.close();
          bitmapRef.current = bmp;
          frameSizeRef.current = { w: bmp.width, h: bmp.height };
          lastFrameAtRef.current = Date.now();
          framesRef.current += 1;
        })
        .catch(() => { /* corrupt frame — skip */ })
        .finally(() => { decodingRef.current = false; decodeNext(); });
    } catch {
      decodingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const paint = () => {
      rafRef.current = requestAnimationFrame(paint);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (cw === 0 || ch === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#03080f';
      ctx.fillRect(0, 0, cw, ch);

      const bmp = bitmapRef.current;
      if (!bmp) {
        rectRef.current = { ox: 0, oy: 0, scale: 1 };
        if (overlayRef.current) overlayRef.current.style.opacity = '0';
        return;
      }
      const { w, h } = frameSizeRef.current;
      const scale = Math.min(cw / w, ch / h);
      const dw = w * scale;
      const dh = h * scale;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;
      rectRef.current = { ox, oy, scale };
      ctx.drawImage(bmp, ox, oy, dw, dh);

      // thin frame around the live picture
      ctx.strokeStyle = 'rgba(0,229,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, dw - 1, dh - 1);

      // reticle follows Jarvis's virtual mouse, in CSS px over the canvas
      const ov = overlayRef.current;
      if (ov) {
        const vp = viewportRef.current;
        const cx = ox + (cursorRef.current.x / vp.width) * dw;
        const cy = oy + (cursorRef.current.y / vp.height) * dh;
        ov.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        ov.style.opacity = '1';
      }
    };
    rafRef.current = requestAnimationFrame(paint);

    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      bitmapRef.current?.close();
      bitmapRef.current = null;
    };
  }, []);

  // ── fps / liveness ticker ───────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const f = framesRef.current;
      framesRef.current = 0;
      setFps(f);
      setConn((prev) => {
        if (prev === 'offline' || prev === 'connecting' || prev === 'nosession') return prev;
        return Date.now() - lastFrameAtRef.current < 2500 ? 'live' : 'idle';
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── socket ──────────────────────────────────────────────────────
  useEffect(() => {
    let ws: WebSocket | null = null;

    const connect = () => {
      if (!mountedRef.current) return;
      setConn('connecting');
      try {
        ws = new WebSocket(computeBrowserWsUrl());
      } catch {
        retryRef.current = setTimeout(connect, 2000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'subscribe' }));
        setConn('idle');
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        if (typeof ev.data !== 'string') return;
        let msg: FrameMsg | StateMsg | (CursorMsg & { type: string });
        try {
          msg = JSON.parse(ev.data) as FrameMsg | StateMsg | (CursorMsg & { type: string });
        } catch {
          return;
        }
        if (msg.type === 'frame') {
          const f = msg as FrameMsg;
          if (typeof f.data !== 'string') return;
          pendingRef.current = f.data; // newest wins; stale frame discarded
          decodeNext();
          if (f.cursor) applyCursor(f.cursor);
        } else if (msg.type === 'cursor') {
          applyCursor(msg as CursorMsg);
        } else if (msg.type === 'state') {
          const s = msg as StateMsg;
          setUrl(typeof s.url === 'string' ? s.url : '');
          setTitle(typeof s.title === 'string' ? s.title : '');
          if (s.viewport && s.viewport.width > 0) { setViewport(s.viewport); viewportRef.current = s.viewport; }
          setConn(s.session ? (Date.now() - lastFrameAtRef.current < 2500 ? 'live' : 'idle') : 'nosession');
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mountedRef.current) return;
        setConn('offline');
        retryRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => { /* close handler drives the retry */ };
    };

    const applyCursor = (c: CursorMsg) => {
      if (typeof c.x !== 'number' || typeof c.y !== 'number') return;
      cursorRef.current = { x: c.x, y: c.y, click: !!c.click };
      if (c.click && !clickRef.current) setPulse((p) => p + 1);
      clickRef.current = !!c.click;
    };

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try { sock.send(JSON.stringify({ type: 'unsubscribe' })); } catch { /* ignore */ }
      }
      try { sock?.close(); } catch { /* ignore */ }
      wsRef.current = null;
      pendingRef.current = null;
    };
  }, [decodeNext]);

  // Tell the server whether this client may drive the page.
  useEffect(() => { sendMsg({ type: 'control', enabled: control }); }, [control, sendMsg]);

  // ── coordinate mapping (canvas px → page px) ────────────────────
  const toPage = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const { ox, oy, scale } = rectRef.current;
    if (scale <= 0) return null;
    const fx = (clientX - r.left - ox) / scale;
    const fy = (clientY - r.top - oy) / scale;
    const { w, h } = frameSizeRef.current;
    if (fx < 0 || fy < 0 || fx > w || fy > h) return null;
    // frame px → page px (frame is a capture of the viewport)
    return { x: (fx / w) * viewport.width, y: (fy / h) * viewport.height };
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!control) return;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    sendMsg({ type: 'input', kind: 'click', x: p.x, y: p.y, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' });
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!control) return;
    // Throttle: a raw mousemove firehose would queue hundreds of CDP moves.
    const now = Date.now();
    if (now - lastMoveSentRef.current < 50) return;
    lastMoveSentRef.current = now;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    sendMsg({ type: 'input', kind: 'move', x: p.x, y: p.y });
  };

  const onCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!control) return;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    sendMsg({ type: 'input', kind: 'scroll', x: p.x, y: p.y, deltaY: e.deltaY, deltaX: e.deltaX });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!control) return;
    const special: Record<string, string> = {
      Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    };
    if (special[e.key]) {
      e.preventDefault();
      sendMsg({ type: 'input', kind: 'key', key: special[e.key] });
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      sendMsg({ type: 'input', kind: 'text', text: e.key });
    }
  };

  const dot = DOT[conn];
  const showCursor = conn === 'live' || conn === 'idle';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#03080f' }}>
      {/* chrome bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 8px',
        borderBottom: '1px solid rgba(0,229,255,0.15)',
        background: 'rgba(0,15,35,0.7)',
        fontSize: 10, letterSpacing: '0.06em', flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: dot.color, boxShadow: `0 0 6px ${dot.color}`, flexShrink: 0,
        }} />
        <span style={{ color: dot.color, minWidth: 62, fontSize: 9, fontWeight: 700 }}>{dot.label}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{
            color: 'var(--text-primary)', fontSize: 10,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }} title={url}>
            {url || '—'}
          </span>
          {title && (
            <span style={{
              color: 'var(--text-dim)', fontSize: 9,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }} title={title}>
              {title}
            </span>
          )}
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: 9, flexShrink: 0 }}>{fps} fps</span>
        <button
          onClick={() => setControl((c) => !c)}
          title="Forward your clicks, scroll and keystrokes to Jarvis's browser"
          style={{
            flexShrink: 0,
            background: control ? 'rgba(255,140,0,0.18)' : 'rgba(0,229,255,0.08)',
            border: `1px solid ${control ? 'rgba(255,140,0,0.6)' : 'rgba(0,229,255,0.3)'}`,
            color: control ? 'var(--accent-amber)' : 'var(--accent-primary)',
            borderRadius: 2, padding: '2px 7px',
            fontSize: 9, letterSpacing: '0.12em', fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {control ? 'CONTROL ON' : 'CONTROL OFF'}
        </button>
      </div>

      {/* live view */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ position: 'relative', flex: 1, minHeight: 0, outline: 'none', overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onWheel={onCanvasWheel}
          onContextMenu={(e) => { if (control) e.preventDefault(); }}
          style={{
            display: 'block', width: '100%', height: '100%',
            cursor: control ? 'crosshair' : 'default',
          }}
        />

        {/* cyan reticle tracking Jarvis's mouse */}
        {showCursor && (
          <div ref={overlayRef} style={{
            position: 'absolute', left: 0, top: 0,
            width: 0, height: 0, pointerEvents: 'none',
            opacity: 0, willChange: 'transform',
          }}>
            <div style={{
              position: 'absolute', left: -9, top: -0.5, width: 18, height: 1,
              background: 'var(--accent-primary)', boxShadow: '0 0 6px rgba(0,229,255,0.9)',
            }} />
            <div style={{
              position: 'absolute', left: -0.5, top: -9, width: 1, height: 18,
              background: 'var(--accent-primary)', boxShadow: '0 0 6px rgba(0,229,255,0.9)',
            }} />
            <div style={{
              position: 'absolute', left: -5, top: -5, width: 10, height: 10,
              border: '1px solid rgba(0,229,255,0.85)', borderRadius: '50%',
              boxShadow: '0 0 8px rgba(0,229,255,0.5)',
            }} />
            {pulse > 0 && (
              <div key={pulse} style={{
                position: 'absolute', left: -6, top: -6, width: 12, height: 12,
                border: '1px solid rgba(0,229,255,0.9)', borderRadius: '50%',
                animation: 'jarvis-browser-ping 600ms ease-out forwards',
              }} />
            )}
          </div>
        )}

        {conn === 'nosession' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            color: 'var(--text-dim)', textAlign: 'center', pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 30, color: 'var(--accent-primary)', opacity: 0.3 }}>◌</div>
            <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>NO BROWSER SESSION</div>
            <div style={{ fontSize: 9, opacity: 0.7, maxWidth: 260, lineHeight: 1.6 }}>
              Ask Jarvis to browse something — the stream attaches automatically.
            </div>
          </div>
        )}

        {conn === 'offline' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-red)', fontSize: 10, letterSpacing: '0.2em',
            pointerEvents: 'none',
          }}>
            STREAM LINK LOST — RETRYING
          </div>
        )}
      </div>
    </div>
  );
}
