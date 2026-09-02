import type { FastifyInstance } from 'fastify';
import { getAppId, queryFull, isConfigured } from '../modules/wolfram.js';

export async function wolframRoutes(app: FastifyInstance) {
  app.get('/api/wolfram/status', async (_req, reply) => {
    const id = getAppId();
    return reply.send({ configured: !!id, preview: id ? `${id.slice(0, 4)}…${id.slice(-3)}` : null });
  });

  // Direct queries from the HUD's Wolfram module — the AppID stays server-side.
  app.get('/api/wolfram/query', async (request, reply) => {
    const input = ((request.query as Record<string, unknown>)['input'] as string | undefined)?.trim();
    if (!input) return reply.status(400).send({ error: 'input required' });
    if (!isConfigured()) return reply.status(412).send({ error: 'Wolfram|Alpha is not configured — set WOLFRAM_APP_ID in .env.' });
    return reply.send(await queryFull(input));
  });
}
