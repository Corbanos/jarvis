import { contextFromRequest, requestContext } from '../core/request-context.js';
import type { FastifyInstance } from 'fastify';
import {
  clearOperatorLocation,
  getFreshLocation,
  getOperatorLocation,
  parseBrowserLocation,
  setOperatorLocation,
} from '../core/operator-location.js';

export async function locationRoutes(app: FastifyInstance) {
  // Enforce attribution on every location route, including GET and DELETE.
  app.addHook('onRequest', (request, reply, done) => {
    const context = contextFromRequest(request);
    if (!context.clientId) { void reply.status(400).send({ error: 'X-Jarvis-Client-Id required' }); return; }
    requestContext.run(context, done);
  });
  app.post('/api/location', async (request, reply) => {
    const location = parseBrowserLocation(request.body);
    if (!location) {
      return reply.status(400).send({ error: 'valid lat, lon, and accuracy are required' });
    }
    setOperatorLocation(location);
    return reply.send({ ok: true, location: getOperatorLocation() });
  });

  app.get('/api/location', async (_req, reply) => {
    const loc = getOperatorLocation();
    return reply.send({
      location: loc,
      fresh: !!getFreshLocation(),
      ageMs: loc ? Math.max(0, Date.now() - loc.updatedAt) : null,
    });
  });

  app.delete('/api/location', async (_req, reply) => {
    clearOperatorLocation();
    return reply.send({ ok: true });
  });
}
