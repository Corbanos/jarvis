import type { FastifyInstance } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '../core/logger.js';

const execAsync = promisify(exec);

export async function shellRoutes(app: FastifyInstance) {
  app.post('/api/shell', async (request, reply) => {
    const body = request.body as { command: string; timeout?: number };
    if (!body.command) return reply.status(400).send({ error: 'command required' });

    log.info(`[shell] ${body.command.slice(0, 100)}`);

    try {
      const { stdout, stderr } = await execAsync(body.command, {
        timeout: body.timeout ?? 30000,
        shell: '/bin/zsh',
        maxBuffer: 4 * 1024 * 1024,
      });
      return reply.send({
        output: [stdout, stderr ? `STDERR:\n${stderr}` : ''].filter(Boolean).join('\n').trim() || '(no output)',
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return reply.status(500).send({
        error: e.message ?? String(err),
        output: [e.stdout, e.stderr].filter(Boolean).join('\n'),
      });
    }
  });
}
