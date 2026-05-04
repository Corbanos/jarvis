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
import { log } from './core/logger.js';
import { existsSync } from 'fs';

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

  // ── WebSocket ──────────────────────────────────────────────
  const ws = await registerWS(app);
  app.decorate('ws', ws);

  // ── Tools ─────────────────────────────────────────────────
  toolRegistry.register(shellTool);
  toolRegistry.register(filesystemTool);
  toolRegistry.register(spawnAgentTool);
  toolRegistry.register(computerTool);
  toolRegistry.register(browserTool);
  toolRegistry.register(scheduleTool);

  // ── Agent pool ─────────────────────────────────────────────
  const agentPool = createAgentPool(ws);
  app.decorate('agentPool', agentPool);
  setSpawnFn((goal) => agentPool.spawn(goal));

  // ── Jarvis AI ──────────────────────────────────────────────
  const jarvis = createJarvis(ws);
  app.decorate('jarvis', jarvis);

  // ── Scheduler ─────────────────────────────────────────────
  initScheduler(
    (prompt, sessionId) => jarvis.chat(prompt, sessionId, undefined, { speak: true }),
    (event) => ws.broadcast(event as Parameters<typeof ws.broadcast>[0])
  );

  // ── Request logging middleware ─────────────────────────────
  app.addHook('onRequest', async (req) => {
    (req as Record<string, unknown>)['_start'] = Date.now();
  });
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as Record<string, unknown>)['_start'] as number ?? Date.now();
    const path = req.url;
    // Skip noisy health/ws polls
    if (!path.includes('/ws') && !path.includes('/health')) {
      log.request(req.method, path, reply.statusCode, Date.now() - start);
    }
  });

  // ── Routes ────────────────────────────────────────────────
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(telemetryRoutes);
  await app.register(voiceRoutes);
  await app.register(jobRoutes);

  app.get('/api/health', async () => ({
    status: 'OPERATIONAL', system: 'J.A.R.V.I.S.', version: '2.0.0',
    uptime: process.uptime(),
    agents: agentPool.list().filter((a) => a.status === 'running').length,
    wsClients: ws.clientCount(), timestamp: Date.now(),
  }));

  // ── Start ─────────────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' });

  // ── Startup diagnostics ────────────────────────────────────
  log.banner(PORT);

  log.section('CAPABILITIES');

  // API Key
  const hasKey = !!process.env['ANTHROPIC_API_KEY']?.startsWith('sk-');
  log.check('Anthropic API Key', hasKey, hasKey ? `sk-...${process.env['ANTHROPIC_API_KEY']?.slice(-4)}` : 'NOT SET — add to .env');

  // Whisper
  const whisperOk = await checkWhisperAvailable();
  log.check('Whisper VTT', whisperOk, whisperOk
    ? '/opt/homebrew/bin/whisper-cli + ggml-base.en.bin'
    : 'whisper-cli or model not found');

  // ffmpeg (needed for audio conversion)
  let ffmpegOk = false;
  try {
    const { execSync } = await import('child_process');
    execSync('ffmpeg -version 2>/dev/null', { timeout: 3000 });
    ffmpegOk = true;
  } catch { /* ignore */ }
  log.check('ffmpeg (audio convert)', ffmpegOk, ffmpegOk ? 'available' : 'install: brew install ffmpeg');

  // TTS
  const voiceInfo = await getVoiceInfo();
  log.check('TTS Voice', true, voiceInfo.kokoroAvailable
    ? 'Kokoro (local neural — best quality)'
    : `macOS ${voiceInfo.voice} (British) @ ${voiceInfo.rate} wpm`);

  // Computer use
  const cuStatus = await checkComputerUse();
  log.check('Computer Use (nut-js)', cuStatus.available,
    cuStatus.available ? `${cuStatus.screenSize?.width}x${cuStatus.screenSize?.height} display` : cuStatus.reason ?? 'unavailable');

  // Playwright
  let playwrightOk = false;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true });
    await b.close();
    playwrightOk = true;
  } catch { /* ignore */ }
  log.check('Browser Control (Playwright)', playwrightOk, playwrightOk ? 'Chromium ready' : 'run: npx playwright install chromium');

  // SQLite
  const dbOk = existsSync(`${process.env['HOME']}/.jarvis/jarvis.db`);
  log.check('SQLite Memory', dbOk, `~/.jarvis/jarvis.db`);

  log.section('TOOLS');
  toolRegistry.all().forEach((t) => log.tool(t.name));

  log.section('ROUTES');
  log.check('POST /api/chat', true, 'streaming SSE');
  log.check('POST /api/voice/transcribe', true, 'whisper.cpp → text');
  log.check('POST /api/voice/chat', true, 'whisper → Jarvis → TTS');
  log.check('GET  /api/agents', true, 'agent pool');
  log.check('GET  /api/jobs', true, 'scheduler');
  log.check('POST /api/telemetry/event', true, 'ingest external events');
  log.check('GET  /ws', true, 'WebSocket HUD feed');

  log.ready(PORT);

  // Broadcast online status
  ws.broadcast({
    type: 'status',
    payload: {
      message: 'JARVIS v2.0 ONLINE',
      capabilities: { whisper: whisperOk, ffmpeg: ffmpegOk, computerUse: cuStatus.available, browser: playwrightOk, tts: true },
    },
    timestamp: Date.now(),
  });
}

main().catch((err) => {
  log.error('STARTUP', String(err));
  process.exit(1);
});
