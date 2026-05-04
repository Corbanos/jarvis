import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';

export async function chatRoutes(app: FastifyInstance) {
  // Streaming chat endpoint
  app.post('/api/chat', async (request, reply) => {
    const body = request.body as {
      message: string;
      sessionId?: string;
      isAgent?: boolean;
      agentId?: string;
    };

    if (!body.message) {
      return reply.status(400).send({ error: 'message required' });
    }

    const sessionId = body.sessionId ?? 'default';
    const jarvis = app.jarvis;

    // Stream response
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    let textBuffer = '';

    try {
      const result = await jarvis.chat(body.message, sessionId, (token) => {
        textBuffer += token;
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
      });

      reply.raw.write(`data: ${JSON.stringify({ type: 'done', text: result.text, toolCalls: result.toolCalls })}\n\n`);
    } catch (err) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
    }

    reply.raw.end();
  });

  // Non-streaming for agents
  app.post('/api/chat/sync', async (request, reply) => {
    const body = request.body as { message: string; sessionId?: string };
    const sessionId = body.sessionId ?? uuid();
    const result = await app.jarvis.chat(body.message, sessionId);
    return reply.send(result);
  });
}
