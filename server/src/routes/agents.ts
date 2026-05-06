import type { FastifyInstance } from 'fastify';

export async function agentRoutes(app: FastifyInstance) {
  // List all agents (running + historical)
  app.get('/api/agents', async (_req, reply) => {
    return reply.send(app.agentPool.list());
  });

  // List only running agents
  app.get('/api/agents/running', async (_req, reply) => {
    return reply.send(app.agentPool.listRunning());
  });

  // List only historical (completed/failed) agents
  app.get('/api/agents/history', async (_req, reply) => {
    return reply.send(app.agentPool.listHistory());
  });

  // Spawn a new agent
  app.post('/api/agents', async (request, reply) => {
    const body = request.body as { goal: string; projectId?: string; parentAgentId?: string; role?: string };
    if (!body.goal) return reply.status(400).send({ error: 'goal required' });
    const agent = app.agentPool.spawn(body.goal, { projectId: body.projectId, parentAgentId: body.parentAgentId, role: body.role });
    return reply.status(201).send(agent);
  });

  // Get a single agent with full details
  app.get('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = app.agentPool.get(id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send(agent);
  });

  // Get full logs for an agent
  app.get('/api/agents/:id/logs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const logs = app.agentPool.getLogs(id);
    if (!logs.length) {
      const agent = app.agentPool.get(id);
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    }
    return reply.send({ logs });
  });

  // Kill (abort) an agent
  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const killed = app.agentPool.kill(id);
    return reply.send({ success: killed });
  });

  // Send live instruction to running agent
  app.post('/api/agents/:id/instruct', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { instruction: string };
    if (!body.instruction) return reply.status(400).send({ error: 'instruction required' });
    
    const sent = app.agentPool.sendInstruction(id, body.instruction);
    if (!sent) {
      return reply.status(400).send({ error: 'Agent not running or not found' });
    }
    return reply.send({ success: true, instruction: body.instruction });
  });

  // Clear all historical agents
  app.delete('/api/agents/history', async (_req, reply) => {
    const count = app.agentPool.clearHistory();
    return reply.send({ success: true, cleared: count });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Model Management
  // ─────────────────────────────────────────────────────────────────────

  // Get current model and available models
  app.get('/api/model', async (_req, reply) => {
    return reply.send({
      current: app.agentPool.getModel(),
      available: app.agentPool.getAvailableModels(),
    });
  });

  // Set the model for all future agents (and main Jarvis)
  app.post('/api/model', async (request, reply) => {
    const body = request.body as { model: string };
    if (!body.model) return reply.status(400).send({ error: 'model required' });

    const valid = app.agentPool.setModel(body.model);
    if (!valid) {
      return reply.status(400).send({ 
        error: 'Invalid model', 
        available: app.agentPool.getAvailableModels() 
      });
    }

    // Also update the main Jarvis model
    if (app.jarvis?.setModel) {
      app.jarvis.setModel(body.model);
    }

    return reply.send({ 
      success: true, 
      model: body.model,
      message: 'Model updated for all future agents and Jarvis'
    });
  });
}
