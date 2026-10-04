/**
 * Live browser stream — GET /ws/browser
 *
 * Streams Jarvis's Playwright/Chromium page to HUD clients as JPEG frames
 * using the Chrome DevTools Protocol screencast (Page.startScreencast), plus
 * the virtual cursor position tracked in browser-control.ts.
 *
 * Wire protocol (server → client, one JSON object per WS message):
 *   { type:'state',  session:boolean, url, title, viewport:{width,height} }
 *   { type:'frame',  data:<base64 jpeg>, width, height, ts, cursor:{x,y,click} }
 *   { type:'cursor', x, y, click }
 *
 * client → server:
 *   { type:'subscribe' } | { type:'unsubscribe' } | { type:'ping' }
 *   { type:'control', enabled:boolean }
 *   { type:'input', kind:'move'|'click'|'scroll'|'key'|'text', ... }
 *
 * The screencast only runs while at least one client is subscribed; the last
 * unsubscribe tears down the CDP session and every timer, so a closed panel
 * costs nothing.
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { CDPSession, Page } from 'playwright';
import * as bc from './browser-control.js';
import { log } from '../core/logger.js';

/** Frame budget: 10 fps ceiling. */
const MIN_FRAME_INTERVAL_MS = 100;
/** If the screencast has been silent this long, push a keyframe screenshot. */
const KEYFRAME_IDLE_MS = 2000;
/** Don't pile frames onto a socket that hasn't drained. */
const MAX_BUFFERED_BYTES = 1_000_000;

interface Subscriber {
  socket: WebSocket;
  subscribed: boolean;
  control: boolean;
}

const subs = new Set<Subscriber>();

let attachedPage: Page | null = null;
let session: CDPSession | null = null;
let unsubPageChange: (() => void) | null = null;
let waitTimer: NodeJS.Timeout | null = null;
let metaTimer: NodeJS.Timeout | null = null;
let cursorTimer: NodeJS.Timeout | null = null;
let keyframeTimer: NodeJS.Timeout | null = null;
let lastFrameAt = 0;
let keyframeInFlight = false;
let lastMeta: { url: string; title: string } = { url: '', title: '' };
let lastCursorSent = '';
let onLoadHandler: (() => void) | null = null;

// ── plumbing ───────────────────────────────────────────────────────

function activeSubs(): Subscriber[] {
  return [...subs].filter((s) => s.subscribed && s.socket.readyState === 1);
}

function send(sub: Subscriber, msg: string, isFrame = false): void {
  try {
    if (sub.socket.readyState !== 1) return;
    if (isFrame && sub.socket.bufferedAmount > MAX_BUFFERED_BYTES) return; // drop, not queue
    sub.socket.send(msg);
  } catch {
    subs.delete(sub);
  }
}

function broadcast(payload: Record<string, unknown>, isFrame = false): void {
  const list = activeSubs();
  if (list.length === 0) return;
  const msg = JSON.stringify(payload);
  for (const sub of list) send(sub, msg, isFrame);
}

function cursorPayload(): { x: number; y: number; click: boolean } {
  const c = bc.getCursor();
  return { x: Math.round(c.x), y: Math.round(c.y), click: Date.now() - c.lastClickAt < 450 };
}

function sendFrame(data: string, width: number, height: number): void {
  lastFrameAt = Date.now();
  broadcast({
    type: 'frame',
    data,
    width,
    height,
    ts: lastFrameAt,
    cursor: cursorPayload(),
  }, true);
}

function sendState(): void {
  const page = attachedPage ?? bc.getActivePage();
  broadcast({
    type: 'state',
    session: !!page,
    url: page ? safeUrl(page) : '',
    title: lastMeta.title,
    viewport: bc.getViewport(),
  });
}

function safeUrl(page: Page): string {
  try { return page.url(); } catch { return ''; }
}

// ── screencast attach / detach ─────────────────────────────────────

async function startScreencast(s: CDPSession): Promise<void> {
  await s.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 60,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  });
}

async function attach(page: Page): Promise<void> {
  if (attachedPage === page && session) return;
  await detach();

  try {
    const s = await page.context().newCDPSession(page);
    session = s;
    attachedPage = page;

    s.on('Page.screencastFrame', (ev) => {
      // ALWAYS ack, even for frames we drop — otherwise Chromium stops
      // producing them after a handful.
      s.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => { /* session gone */ });
      if (Date.now() - lastFrameAt < MIN_FRAME_INTERVAL_MS) return;
      const m = ev.metadata;
      sendFrame(ev.data, Math.round(m.deviceWidth), Math.round(m.deviceHeight));
    });

    s.on('close', () => {
      if (session === s) { session = null; attachedPage = null; }
    });

    await startScreencast(s);

    // A cross-process navigation can silently drop the screencast; restart it
    // on every load and push an immediate keyframe so the view never sticks.
    onLoadHandler = () => {
      void (async () => {
        if (session !== s) return;
        try { await startScreencast(s); } catch { /* ignore */ }
        await pushKeyframe();
        await refreshMeta();
      })();
    };
    page.on('load', onLoadHandler);

    log.info(`[BrowserStream] attached to ${safeUrl(page)}`);
    await refreshMeta();
    await pushKeyframe();
    sendState();
  } catch (err) {
    session = null;
    attachedPage = null;
    log.warn('BrowserStream', `attach failed: ${String(err)}`);
  }
}

async function detach(): Promise<void> {
  const s = session;
  const p = attachedPage;
  session = null;
  attachedPage = null;
  if (p && onLoadHandler) {
    try { p.off('load', onLoadHandler); } catch { /* ignore */ }
  }
  onLoadHandler = null;
  if (s) {
    try { await s.send('Page.stopScreencast'); } catch { /* ignore */ }
    try { await s.detach(); } catch { /* ignore */ }
  }
}

/** Screenshot the live page and push it as a frame (used for keyframes). */
async function pushKeyframe(): Promise<void> {
  const page = attachedPage;
  if (!page || keyframeInFlight || activeSubs().length === 0) return;
  keyframeInFlight = true;
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 5000 });
    const vp = page.viewportSize() ?? bc.getViewport();
    sendFrame(buf.toString('base64'), vp.width, vp.height);
  } catch {
    // Page busy/navigating — the screencast will catch up.
  } finally {
    keyframeInFlight = false;
  }
}

async function refreshMeta(): Promise<void> {
  const page = attachedPage;
  if (!page) return;
  const url = safeUrl(page);
  let title = lastMeta.title;
  try { title = await page.title(); } catch { /* ignore */ }
  if (url !== lastMeta.url || title !== lastMeta.title) {
    lastMeta = { url, title };
    sendState();
  }
}

// ── lifecycle driven by subscriber count ───────────────────────────

function ensureRunning(): void {
  if (activeSubs().length === 0) return;

  if (!unsubPageChange) {
    unsubPageChange = bc.onActivePageChange((page) => {
      if (activeSubs().length === 0) return;
      if (page) void attach(page);
      else { void detach(); lastMeta = { url: '', title: '' }; sendState(); }
    });
  }

  if (!metaTimer) metaTimer = setInterval(() => { void refreshMeta(); }, 1000);

  if (!cursorTimer) {
    cursorTimer = setInterval(() => {
      if (!attachedPage) return;
      const c = cursorPayload();
      const key = `${c.x},${c.y},${c.click}`;
      if (key === lastCursorSent) return;
      lastCursorSent = key;
      broadcast({ type: 'cursor', ...c });
    }, 120);
  }

  if (!keyframeTimer) {
    keyframeTimer = setInterval(() => {
      if (!attachedPage) return;
      if (Date.now() - lastFrameAt < KEYFRAME_IDLE_MS) return;
      void pushKeyframe();
    }, KEYFRAME_IDLE_MS);
  }

  const page = bc.getActivePage();
  if (page) {
    if (page !== attachedPage) void attach(page);
    if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
    return;
  }

  // No browser session yet — poll cheaply until Jarvis opens one.
  if (!waitTimer) {
    waitTimer = setInterval(() => {
      if (activeSubs().length === 0) return;
      const p = bc.getActivePage();
      if (p) {
        if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
        void attach(p);
      }
    }, 1500);
  }
}

function stopIfIdle(): void {
  if (activeSubs().length > 0) return;
  for (const t of [waitTimer, metaTimer, cursorTimer, keyframeTimer]) if (t) clearInterval(t);
  waitTimer = null; metaTimer = null; cursorTimer = null; keyframeTimer = null;
  if (unsubPageChange) { unsubPageChange(); unsubPageChange = null; }
  lastCursorSent = '';
  void detach();
  log.info('[BrowserStream] idle — screencast stopped');
}

// ── remote control input ───────────────────────────────────────────

interface InputMsg {
  kind?: string;
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  button?: string;
  key?: string;
  text?: string;
}

function clampX(x: number): number {
  const vp = bc.getViewport();
  return Math.max(0, Math.min(vp.width - 1, Math.round(x)));
}
function clampY(y: number): number {
  const vp = bc.getViewport();
  return Math.max(0, Math.min(vp.height - 1, Math.round(y)));
}

async function handleInput(msg: InputMsg): Promise<void> {
  const x = clampX(typeof msg.x === 'number' ? msg.x : bc.getCursor().x);
  const y = clampY(typeof msg.y === 'number' ? msg.y : bc.getCursor().y);
  switch (msg.kind) {
    case 'move':
      await bc.remoteMove(x, y);
      break;
    case 'click': {
      const button = msg.button === 'right' ? 'right' : msg.button === 'middle' ? 'middle' : 'left';
      await bc.remoteClick(x, y, button);
      break;
    }
    case 'scroll':
      await bc.remoteScroll(x, y, typeof msg.deltaY === 'number' ? msg.deltaY : 0, typeof msg.deltaX === 'number' ? msg.deltaX : 0);
      break;
    case 'key':
      if (typeof msg.key === 'string' && msg.key.length > 0 && msg.key.length < 40) await bc.remoteKey(msg.key);
      break;
    case 'text':
      if (typeof msg.text === 'string' && msg.text.length > 0 && msg.text.length <= 2000) await bc.remoteText(msg.text);
      break;
    default:
      break;
  }
}

// ── route ──────────────────────────────────────────────────────────

export async function registerBrowserStream(app: FastifyInstance): Promise<void> {
  app.get('/ws/browser', { websocket: true }, (socket) => {
    const sub: Subscriber = { socket, subscribed: false, control: false };
    subs.add(sub);

    send(sub, JSON.stringify({
      type: 'state',
      session: !!bc.getActivePage(),
      url: bc.getActivePage() ? safeUrl(bc.getActivePage()!) : '',
      title: lastMeta.title,
      viewport: bc.getViewport(),
    }));

    socket.on('message', (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = typeof msg['type'] === 'string' ? (msg['type'] as string) : '';
      switch (type) {
        case 'subscribe':
          sub.subscribed = true;
          ensureRunning();
          // A late joiner gets an immediate picture rather than waiting for
          // the page to change.
          void pushKeyframe();
          break;
        case 'unsubscribe':
          sub.subscribed = false;
          stopIfIdle();
          break;
        case 'control':
          sub.control = msg['enabled'] === true;
          break;
        case 'input':
          if (!sub.control) return;
          void handleInput(msg as InputMsg).catch(() => { /* input errors are non-fatal */ });
          break;
        case 'ping':
          send(sub, JSON.stringify({ type: 'pong', ts: Date.now() }));
          break;
        default:
          break;
      }
    });

    const bye = () => {
      subs.delete(sub);
      stopIfIdle();
    };
    socket.on('close', bye);
    socket.on('error', bye);
  });
}

/** Test/diagnostics hook. */
export function streamStats(): { subscribers: number; attached: boolean; url: string } {
  return {
    subscribers: activeSubs().length,
    attached: !!session,
    url: lastMeta.url,
  };
}
