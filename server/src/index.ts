import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerWS } from './ws.js';
import { createJarvis } from './core/jarvis.js';
import { createAgentPool } from './core/agent-pool.js';
import { toolRegistry } from './core/tool-registry.js';
import { shellTool } from './tools/shell.js';
import { filesystemTool } from './tools/filesystem.js';
import { spawnAgentTool, setSpawnFn } from './tools/spawn-agent.js';
import { chatRoutes } from './routes/chat.js';
import { agentRoutes } from './routes/agents.js';
import { telemetryRoutes } from './routes/telemetry.js';

// Augment Fastify instance
declare module 'fastify' {
  interface FastifyInstance {
    jarvis: ReturnType<typeof createJarvis>;
    agentPool: ReturnType<typeof createAgentPool>;
    ws: Awaited<ReturnType<typeof registerWS>>;
  }
}

const PORT = parseInt(process.env['JARVIS_PORT'] ?? '7777', 10);

async function main() {
  const app = Fastify({ logger: false });

  // CORS
  await app.register(cors, { origin: '*' });

  // WebSocket hub
  const ws = await registerWS(app);
  app.decorate('ws', ws);

  // Register tools
  toolRegistry.register(shellTool);
  toolRegistry.register(filesystemTool);
  toolRegistry.register(spawnAgentTool);

  // Agent pool
  const agentPool = createAgentPool(ws);
  app.decorate('agentPool', agentPool);

  // Wire spawn tool to agent pool
  setSpawnFn((goal) => agentPool.spawn(goal));

  // Jarvis AI
  const jarvis = createJarvis(ws);
  app.decorate('jarvis', jarvis);

  // Routes
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(telemetryRoutes);

  // Health
  app.get('/api/health', async () => ({
    status: 'OPERATIONAL',
    system: 'J.A.R.V.I.S.',
    version: '1.0.0',
    uptime: process.uptime(),
    agents: agentPool.list().filter((a) => a.status === 'running').length,
    wsClients: ws.clientCount(),
    timestamp: Date.now(),
  }));

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║  J.A.R.V.I.S. — Just A Rather Very           ║
  ║                  Intelligent System           ║
  ║                                               ║
  ║  Status  : ONLINE                            ║
  ║  Port    : ${PORT}                            ║
  ║  Tools   : ${toolRegistry.all().length} registered                  ║
  ╚═══════════════════════════════════════════════╝
  `);

  ws.broadcast({ type: 'status', payload: { message: 'JARVIS ONLINE', port: PORT }, timestamp: Date.now() });
}

main().catch((err) => {
  console.error('JARVIS STARTUP FAILURE:', err);
  process.exit(1);
});
