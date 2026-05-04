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
import { computerTool } from './tools/computer.js';
import { browserTool } from './tools/browser.js';
import { scheduleTool } from './tools/schedule.js';
import { chatRoutes } from './routes/chat.js';
import { agentRoutes } from './routes/agents.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { voiceRoutes } from './routes/voice.js';
import { jobRoutes } from './routes/jobs.js';
import { initScheduler } from './modules/scheduler.js';
import { checkAvailable as checkComputerUse } from './modules/computer-use.js';
import { checkWhisperAvailable } from './modules/voice-vtt.js';
import { getVoiceInfo } from './modules/voice-tts.js';

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

  await app.register(cors, { origin: '*' });

  const ws = await registerWS(app);
  app.decorate('ws', ws);

  // Register all tools
  toolRegistry.register(shellTool);
  toolRegistry.register(filesystemTool);
  toolRegistry.register(spawnAgentTool);
  toolRegistry.register(computerTool);
  toolRegistry.register(browserTool);
  toolRegistry.register(scheduleTool);

  // Agent pool
  const agentPool = createAgentPool(ws);
  app.decorate('agentPool', agentPool);
  setSpawnFn((goal) => agentPool.spawn(goal));

  // Jarvis AI
  const jarvis = createJarvis(ws);
  app.decorate('jarvis', jarvis);

  // Init scheduler (wired to Jarvis chat)
  initScheduler(
    (prompt, sessionId) => jarvis.chat(prompt, sessionId, undefined, { speak: true }),
    (event) => ws.broadcast(event as Parameters<typeof ws.broadcast>[0])
  );

  // Routes
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(telemetryRoutes);
  await app.register(voiceRoutes);
  await app.register(jobRoutes);

  // Health
  app.get('/api/health', async () => ({
    status: 'OPERATIONAL',
    system: 'J.A.R.V.I.S.',
    version: '2.0.0',
    uptime: process.uptime(),
    agents: agentPool.list().filter((a) => a.status === 'running').length,
    wsClients: ws.clientCount(),
    timestamp: Date.now(),
  }));

  await app.listen({ port: PORT, host: '0.0.0.0' });

  // System checks
  const [cuStatus, whisperOk, voiceInfo] = await Promise.all([
    checkComputerUse(),
    checkWhisperAvailable(),
    getVoiceInfo(),
  ]);

  const lines = [
    '╔══════════════════════════════════════════════════════╗',
    '║   J.A.R.V.I.S.  —  v2.0  —  PHASE 2 ONLINE         ║',
    '╠══════════════════════════════════════════════════════╣',
    `║   Port         : ${PORT}                                  ║`,
    `║   Tools        : ${toolRegistry.all().length} registered                         ║`,
    `║   Computer Use : ${cuStatus.available ? `✓ ${cuStatus.screenSize?.width}x${cuStatus.screenSize?.height}` : '✗ unavailable'}                    ║`,
    `║   Whisper VTT  : ${whisperOk ? '✓ base.en model' : '✗ unavailable'}               ║`,
    `║   TTS Voice    : ${voiceInfo.kokoroAvailable ? 'Kokoro (local)' : `macOS ${voiceInfo.voice}`}                  ║`,
    '╚══════════════════════════════════════════════════════╝',
  ];
  console.log('\n' + lines.join('\n') + '\n');

  ws.broadcast({
    type: 'status',
    payload: {
      message: 'JARVIS v2.0 ONLINE — ALL SYSTEMS NOMINAL',
      port: PORT,
      computerUse: cuStatus.available,
      voice: true,
    },
    timestamp: Date.now(),
  });
}

main().catch((err) => {
  console.error('JARVIS STARTUP FAILURE:', err);
  process.exit(1);
});
