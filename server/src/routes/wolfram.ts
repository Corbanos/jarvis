import type { FastifyInstance } from 'fastify';
import { getAppId, getAppIdSource, setAppId, testAppId, queryFull, isConfigured } from '../modules/wolfram.js';
import { log } from '../core/logger.js';

export async function wolframRoutes(app: FastifyInstance) {
  app.get('/api/wolfram/status', async (_req, reply) => {
    const id = getAppId();
    return reply.send({
      configured: !!id,
      source: getAppIdSource(),
      preview: id ? `${id.slice(0, 4)}…${id.slice(-3)}` : null,
    });
  });

  // Validate against Wolfram before saving so a typo fails here, not on the
  // operator's first real question.
  app.post('/api/wolfram/key', async (request, reply) => {
    const body = request.body as { appId?: string };
    const appId = body.appId?.trim();
    if (!appId) return reply.status(400).send({ error: 'No AppID provided' });
    if (getAppIdSource() === 'env') {
      return reply.status(409).send({ error: 'WOLFRAM_APP_ID is set in the environment and takes precedence; change it there.' });
    }
    const result = await testAppId(appId);
    if (!result.ok) {
      log.warn('Wolfram', result.error ?? 'key rejected');
      return reply.status(400).send({ error: result.error });
    }
    setAppId(appId);
    log.check('Wolfram|Alpha', true, `AppID saved (${appId.slice(0, 4)}…)`);
    return reply.send({ ok: true, preview: `${appId.slice(0, 4)}…${appId.slice(-3)}` });
  });

  app.delete('/api/wolfram/key', async (_req, reply) => {
    setAppId(null);
    return reply.send({ ok: true });
  });

  // Direct queries from the HUD's Wolfram module — the AppID stays server-side.
  app.get('/api/wolfram/query', async (request, reply) => {
    const input = ((request.query as Record<string, unknown>)['input'] as string | undefined)?.trim();
    if (!input) return reply.status(400).send({ error: 'input required' });
    if (!isConfigured()) return reply.status(412).send({ error: 'Wolfram|Alpha is not configured — add an AppID under KEYS.' });
    const result = await queryFull(input);
    return reply.send(result);
  });
}
