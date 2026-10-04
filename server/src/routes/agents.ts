import type { FastifyInstance } from 'fastify';
import { getRouting, setRouting, usingOllama } from '../core/model-routing.js';
import { CURATED_OPENAI_MODELS } from '../core/providers/openai.js';

export async function agentRoutes(app: FastifyInstance) {
  // The control endpoints (pause/stop) take no payload, but browsers and curl
  // both like to send `Content-Type: application/json` with an empty body,
  // which Fastify rejects by default. Scoped to this plugin only.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) return done(null, {});
    try { done(null, JSON.parse(raw)); } catch (err) { done(err as Error, undefined); }
  });

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

  // ─────────────────────────────────────────────────────────────────────
  // Live control: resume / steer / pause / stop
  // Auth is the global onRequest hook in core/auth.ts, same as every other
  // /api/agents route. Each returns the updated record; the pool broadcasts
  // the agent_update / agent_instruction_queued events the HUD already reads.
  // Ids may be abbreviated (case-insensitive prefix, e.g. "AECF653A").
  // ─────────────────────────────────────────────────────────────────────

  // Re-enter a failed/stopped/paused/completed agent's loop in place.
  app.post('/api/agents/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { note?: string };
    const res = app.agentPool.resume(id, body.note);
    if (!res.ok) {
      const code = res.error?.startsWith('no agent') ? 404 : 409;
      return reply.status(code).send({ error: res.error, agent: res.agent });
    }
    return reply.send(res.agent);
  });

  // Inject an instruction into a running agent (or queue it for its resume).
  app.post('/api/agents/:id/steer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { message?: string; instruction?: string };
    const message = body.message ?? body.instruction;
    if (!message?.trim()) return reply.status(400).send({ error: 'message required' });
    const res = app.agentPool.steer(id, message);
    if (!res.ok) {
      const code = res.error?.startsWith('no agent') ? 404 : 400;
      return reply.status(code).send({ error: res.error });
    }
    return reply.send({ ...res.agent, delivery: res.delivery });
  });

  // Cooperative pause — takes effect at the next iteration boundary.
  app.post('/api/agents/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const res = app.agentPool.pause(id);
    if (!res.ok) {
      const code = res.error?.startsWith('no agent') ? 404 : 409;
      return reply.status(code).send({ error: res.error, agent: res.agent });
    }
    return reply.send(res.agent);
  });

  // Cooperative stop — same safe-point semantics, still resumable.
  app.post('/api/agents/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const res = app.agentPool.stop(id);
    if (!res.ok) {
      const code = res.error?.startsWith('no agent') ? 404 : 409;
      return reply.status(code).send({ error: res.error, agent: res.agent });
    }
    return reply.send(res.agent);
  });

  // Clear all historical agents
  app.delete('/api/agents/history', async (_req, reply) => {
    const count = app.agentPool.clearHistory();
    return reply.send({ success: true, cleared: count });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Model Management
  // ─────────────────────────────────────────────────────────────────────

  // Get current model and available models.
  // When routing points at Ollama, the picker lists that host's pulled models
  // instead of the Claude line-up — same dropdown, different backend.
  app.get('/api/model', async (_req, reply) => {
    const r = getRouting();
    if (r.provider === 'ollama') {
      return reply.send({
        current: r.ollamaModel,
        available: r.ollamaModelsCache,
        provider: 'ollama',
        host: r.ollamaBaseUrl,
      });
    }
    if (r.provider === 'openai') {
      const known = r.openaiModelsCache.length ? r.openaiModelsCache : CURATED_OPENAI_MODELS;
      return reply.send({
        current: r.openaiModel,
        available: known.includes(r.openaiModel) ? known : [r.openaiModel, ...known],
        provider: 'openai',
      });
    }
    return reply.send({
      current: app.agentPool.getModel(),
      available: app.agentPool.getAvailableModels(),
      provider: 'anthropic',
    });
  });

  // Set the model for all future agents (and main Jarvis)
  app.post('/api/model', async (request, reply) => {
    const body = request.body as { model: string };
    if (!body.model) return reply.status(400).send({ error: 'model required' });

    // Under Ollama routing the name is a local model, so it's validated
    // against what that host has pulled rather than the Claude list.
    if (usingOllama() || getRouting().provider === 'ollama') {
      const r = getRouting();
      if (r.ollamaModelsCache.length && !r.ollamaModelsCache.includes(body.model)) {
        return reply.status(400).send({ error: 'Invalid model', available: r.ollamaModelsCache });
      }
      setRouting({ ollamaModel: body.model });
      return reply.send({
        success: true,
        model: body.model,
        provider: 'ollama',
        message: `Ollama model set to ${body.model} for Jarvis and all future agents`,
      });
    }

    // OpenAI model ids aren't validated against a fixed list — the account's
    // set varies and the operator may type one the picker didn't know.
    if (getRouting().provider === 'openai') {
      setRouting({ openaiModel: body.model.trim() });
      return reply.send({ success: true, model: body.model.trim(), provider: 'openai', message: `OpenAI model set to ${body.model.trim()}` });
    }

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
