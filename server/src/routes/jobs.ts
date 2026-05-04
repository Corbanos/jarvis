import type { FastifyInstance } from 'fastify';
import { listJobs, createJob, deleteJob, toggleJob } from '../modules/scheduler.js';

export async function jobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', async (_req, reply) => reply.send(listJobs()));

  app.post('/api/jobs', async (request, reply) => {
    const body = request.body as { name: string; prompt: string; schedule: string; type?: 'once' | 'interval' };
    if (!body.prompt || !body.schedule) return reply.status(400).send({ error: 'prompt and schedule required' });
    const job = createJob({ ...body, scheduleType: body.type });
    return reply.status(201).send(job);
  });

  app.delete('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ success: deleteJob(id) });
  });

  app.patch('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { enabled: boolean };
    return reply.send({ success: toggleJob(id, body.enabled) });
  });
}
