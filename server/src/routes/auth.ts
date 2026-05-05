import type { FastifyInstance } from 'fastify';
import { getAccessToken, setAccessToken, generateToken } from '../core/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // Whether auth is enabled
  app.get('/api/auth/info', async (_req, reply) => {
    const token = getAccessToken();
    return reply.send({
      enabled: !!token,
      preview: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : null,
    });
  });

  // Verify a token (used by HUD on first remote load)
  app.post('/api/auth/check', async (request, reply) => {
    const body = request.body as { token: string };
    const expected = getAccessToken();
    if (!expected) return reply.send({ ok: true, required: false });
    return reply.send({ ok: body.token === expected, required: true });
  });

  // Set / rotate / clear the token. Loopback-only (auth middleware enforces this).
  app.post('/api/auth/token', async (request, reply) => {
    const body = request.body as { token?: string; generate?: boolean; clear?: boolean };
    if (body.clear) { setAccessToken(null); return reply.send({ enabled: false }); }
    const newToken = body.generate ? generateToken() : body.token?.trim();
    if (!newToken || newToken.length < 12) return reply.status(400).send({ error: 'token must be at least 12 chars' });
    setAccessToken(newToken);
    return reply.send({ enabled: true, token: newToken });
  });
}
