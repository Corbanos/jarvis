import type { FastifyInstance } from 'fastify';
import { getOperatorLocation, setOperatorLocation } from '../core/operator-location.js';

export async function locationRoutes(app: FastifyInstance) {
  // HUD pushes precise browser geolocation here.
  app.post('/api/location', async (request, reply) => {
    const body = request.body as { lat?: number; lon?: number; accuracyM?: number; city?: string; region?: string };
    if (typeof body.lat !== 'number' || typeof body.lon !== 'number') {
      return reply.status(400).send({ error: 'lat and lon are required numbers' });
    }
    setOperatorLocation({
      lat: body.lat,
      lon: body.lon,
      accuracyM: body.accuracyM,
      city: body.city,
      region: body.region,
      source: 'browser',
    });
    return reply.send({ ok: true });
  });

  app.get('/api/location', async (_req, reply) => {
    const loc = getOperatorLocation();
    return reply.send({ location: loc });
  });

  app.delete('/api/location', async (_req, reply) => {
    setOperatorLocation({ lat: 0, lon: 0, source: 'profile' }); // effectively wipes precision
    return reply.send({ ok: true });
  });
}
