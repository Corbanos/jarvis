/**
 * Optional access token gate for remote use.
 * - When JARVIS_ACCESS_TOKEN is unset → no auth (loopback dev mode).
 * - When set → all /api/* and /ws requests must present the token via:
 *     - Authorization: Bearer <token>
 *     - X-Jarvis-Token: <token>
 *     - ?token=<token> query string (only for SSE/WS where headers can't be set easily)
 *
 * Loopback (127.0.0.1, ::1) requests are always allowed so the local HUD dev server works.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { log } from './logger.js';

const CONFIG_FILE = join(homedir(), '.jarvis', 'config.json');

function loadToken(): string | null {
  if (process.env['JARVIS_ACCESS_TOKEN']) return process.env['JARVIS_ACCESS_TOKEN']!;
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { accessToken?: string };
    return cfg.accessToken ?? null;
  } catch {
    return null;
  }
}

let _token = loadToken();

export function getAccessToken(): string | null {
  return _token;
}

export function setAccessToken(token: string | null): void {
  _token = token;
  // Persist to config file
  let cfg: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch { /* ignore */ }
  }
  if (token) cfg['accessToken'] = token;
  else delete cfg['accessToken'];
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function generateToken(): string {
  return randomBytes(24).toString('hex');
}

function isLoopback(req: FastifyRequest): boolean {
  const ip = req.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function extractToken(req: FastifyRequest): string | null {
  // Authorization: Bearer xxx
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();

  // X-Jarvis-Token header
  const xt = req.headers['x-jarvis-token'];
  if (typeof xt === 'string') return xt.trim();

  // ?token=... query (for SSE/WS)
  const q = req.query as Record<string, unknown> | undefined;
  if (q && typeof q['token'] === 'string') return (q['token'] as string).trim();

  return null;
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const token = getAccessToken();
    if (!token) return; // Auth disabled

    // Setup endpoints + health are open
    const url = req.url.split('?')[0]!;
    if (url === '/api/health' || url === '/api/auth/check' || url === '/api/auth/info') return;

    // Loopback always allowed
    if (isLoopback(req)) return;

    const provided = extractToken(req);
    if (provided !== token) {
      log.warn('Auth', `denied ${req.method} ${url} from ${req.ip}`);
      reply.status(401).send({ error: 'unauthorized' });
    }
  });
}
