import type { FastifyInstance } from 'fastify';

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (_req, reply) => {
    return reply.send(app.agentPool.list());
  });

  app.post('/api/agents', async (request, reply) => {
    const body = request.body as { goal: string };
    if (!body.goal) return reply.status(400).send({ error: 'goal required' });
    const agent = app.agentPool.spawn(body.goal);
    return reply.status(201).send(agent);
  });

  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const killed = app.agentPool.kill(id);
    return reply.send({ success: killed });
  });
}
