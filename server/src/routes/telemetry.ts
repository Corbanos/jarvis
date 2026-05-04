import type { FastifyInstance } from 'fastify';
import { memory } from '../core/memory.js';

export async function telemetryRoutes(app: FastifyInstance) {
  app.post('/api/telemetry/event', async (request, reply) => {
    const body = request.body as { source: string; event: string; data?: Record<string, unknown> };
    if (!body.source || !body.event) return reply.status(400).send({ error: 'source and event required' });

    const data = body.data ?? {};
    memory.saveTelemetry(body.source, body.event, data);

    app.ws.broadcast({
      type: 'telemetry',
      payload: { source: body.source, event: body.event, data },
      timestamp: Date.now(),
    });

    return reply.send({ ok: true });
  });

  app.get('/api/telemetry', async (_req, reply) => {
    return reply.send(memory.getRecentTelemetry(100));
  });
}
