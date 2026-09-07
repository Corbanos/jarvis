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
import { weatherTool, setWeatherBroadcast } from './tools/weather.js';
import { dismissTool, setDismissHandler } from './tools/dismiss.js';
import { worldviewTool, setWorldviewBroadcast } from './tools/worldview.js';
import { cadTool, setCadBroadcast, setCadModuleBroadcast } from './tools/cad.js';
import { printerTool, setPrinterBroadcast, setPrinterModuleBroadcast } from './tools/printer.js';
import { moduleTool, setModuleBroadcast } from './tools/module.js';
import { projectsTool, setProjectsBroadcast } from './tools/projects.js';
import { wolframTool, setWolframBroadcast } from './tools/wolfram.js';
import { selfTool } from './tools/self.js';
import { cadRoutes } from './routes/cad.js';
import { shellRoutes } from './routes/shell.js';
import { chatRoutes } from './routes/chat.js';
import { agentRoutes } from './routes/agents.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { voiceRoutes } from './routes/voice.js';
import { jobRoutes } from './routes/jobs.js';
import { setupRoutes, loadConfig, applyApiKey } from './routes/setup.js';
import { authRoutes } from './routes/auth.js';
import { locationRoutes } from './routes/location.js';
import { projectsRoutes } from './routes/projects.js';
import { wolframRoutes } from './routes/wolfram.js';
import { registerAuth, getAccessToken } from './core/auth.js';
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
  // Load persisted API key from config file if not already in env
  if (!process.env['ANTHROPIC_API_KEY']) {
    const saved = loadConfig().anthropicApiKey;
    if (saved) {
      applyApiKey(saved);
      log.info('Loaded API key from ~/.jarvis/config.json');
    }
  }

  // Trust only the loopback reverse proxy (Caddy on :80). Without this every
  // proxied request would present as 127.0.0.1 and the access-token gate would
  // wave the whole LAN through as "loopback". Restricting the trust list to
  // 127.0.0.1 means a device hitting :7777 directly cannot spoof
  // X-Forwarded-For to impersonate a local caller.
  const app = Fastify({ logger: false, trustProxy: ['127.0.0.1', '::1'] });
  await app.register(cors, { origin: '*' });

  // Access token middleware (no-op if not configured)
  registerAuth(app);

  const ws = await registerWS(app);
  app.decorate('ws', ws);

  toolRegistry.register(shellTool);
  toolRegistry.register(filesystemTool);
  toolRegistry.register(spawnAgentTool);
  toolRegistry.register(computerTool);
  toolRegistry.register(browserTool);
  toolRegistry.register(scheduleTool);
  toolRegistry.register(weatherTool);
  toolRegistry.register(cadTool);
  toolRegistry.register(printerTool);
  toolRegistry.register(worldviewTool);
  toolRegistry.register(moduleTool);
  toolRegistry.register(projectsTool);
  toolRegistry.register(wolframTool);
  toolRegistry.register(selfTool);

  // ── Wire tool broadcasts to the WS hub ─────────────────────────────
  // Tools that pop a HUD card or module emit through these helpers.
  // Without this wiring, the tools silently fail with 'unavailable'.
  const broadcastModule = (event: string, payload: Record<string, unknown>) => {
    ws.broadcast({ type: event as never, payload, timestamp: Date.now() });
  };
  const broadcastCard = (cardType: string, data: Record<string, unknown>) => {
    // Cards arrive on the chat path as a 'card' event; the HUD listens and
    // injects them into the latest assistant message.
    ws.broadcast({ type: 'card' as never, payload: { cardType, data }, timestamp: Date.now() });
  };
  setModuleBroadcast(broadcastModule);
  setWorldviewBroadcast(broadcastModule);
  setWeatherBroadcast(broadcastModule);
  setCadBroadcast(broadcastCard);
  setCadModuleBroadcast(broadcastModule);
  setPrinterBroadcast(broadcastCard);
  setPrinterModuleBroadcast(broadcastModule);
  setProjectsBroadcast(broadcastModule);
  setWolframBroadcast(broadcastCard, broadcastModule);

  toolRegistry.register(dismissTool);
  setDismissHandler(() => {
    ws.broadcast({ type: 'dismiss' as never, payload: {}, timestamp: Date.now() });
  });


  const agentPool = createAgentPool(ws);
  app.decorate('agentPool', agentPool);
  setSpawnFn((goal, opts) => agentPool.spawn(goal, opts));

  const jarvis = createJarvis(ws);
  app.decorate('jarvis', jarvis);

  initScheduler(
    (prompt, sessionId) => jarvis.chat(prompt, sessionId, undefined, { speak: true }),
    (event) => ws.broadcast(event as unknown as Parameters<typeof ws.broadcast>[0])
  );

  // Request logging
  app.addHook('onRequest', async (req) => { (req as unknown as Record<string, unknown>)['_start'] = Date.now(); });
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as unknown as Record<string, unknown>)['_start'] as number ?? Date.now();
    if (!req.url.includes('/ws') && !req.url.includes('/health')) {
      log.request(req.method, req.url, reply.statusCode, Date.now() - start);
    }
  });

  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.register(agentRoutes);
  await app.register(telemetryRoutes);
  await app.register(voiceRoutes);
  await app.register(jobRoutes);
  await app.register(cadRoutes);
  await app.register(shellRoutes);
  await app.register(locationRoutes);
  await app.register(projectsRoutes);
  await app.register(wolframRoutes);

  app.get('/api/health', async () => ({
    status: 'OPERATIONAL', system: 'J.A.R.V.I.S.', version: '2.0.0',
    uptime: process.uptime(),
    agents: agentPool.list().filter((a) => a.status === 'running').length,
    wsClients: ws.clientCount(), timestamp: Date.now(),
  }));

  await app.listen({ port: PORT, host: '0.0.0.0' });

  // Startup diagnostics
  log.banner(PORT);
  log.section('CAPABILITIES');

  const hasKey = !!process.env['ANTHROPIC_API_KEY']?.startsWith('sk-');
  const accessToken = getAccessToken();
  log.check('Access Token', !!accessToken, accessToken ? `enabled (${accessToken.slice(0,4)}...${accessToken.slice(-4)})` : 'OFF — local-only mode');

  log.check('Anthropic API Key', hasKey,
    hasKey ? `sk-...${process.env['ANTHROPIC_API_KEY']?.slice(-4)} (configured)` : 'NOT SET — configure via HUD at http://localhost:3001');

  const whisperOk = await checkWhisperAvailable();
  log.check('Whisper VTT', whisperOk, whisperOk ? '/opt/homebrew/bin/whisper-cli + ggml-base.en.bin' : 'not found');

  let ffmpegOk = false;
  try { const { execSync } = await import('child_process'); execSync('ffmpeg -version 2>/dev/null', { timeout: 3000 }); ffmpegOk = true; } catch { /* ignore */ }
  log.check('ffmpeg', ffmpegOk, ffmpegOk ? 'available' : 'brew install ffmpeg');

  const voiceInfo = await getVoiceInfo();
  log.check('TTS', true, voiceInfo.kokoroAvailable ? 'Kokoro (neural)' : `macOS ${voiceInfo.voice}`);

  const cuStatus = await checkComputerUse();
  log.check('Computer Use', cuStatus.available, cuStatus.available ? `${cuStatus.screenSize?.width}x${cuStatus.screenSize?.height}` : String(cuStatus.reason));

  let playwrightOk = false;
  try { const { chromium } = await import('playwright'); const b = await chromium.launch({ headless: true }); await b.close(); playwrightOk = true; } catch { /* ignore */ }
  log.check('Playwright Browser', playwrightOk, playwrightOk ? 'Chromium ready' : 'run: npx playwright install chromium');

  const dbOk = existsSync(`${process.env['HOME']}/.jarvis/jarvis.db`);
  log.check('SQLite', dbOk, `~/.jarvis/jarvis.db`);

  const { isConfigured: wolframOk } = await import('./modules/wolfram.js');
  log.check('Wolfram|Alpha', wolframOk(), wolframOk() ? 'WOLFRAM_APP_ID set' : 'not configured — add WOLFRAM_APP_ID to .env');

  log.section('TOOLS');
  toolRegistry.all().forEach((t) => log.tool(t.name));

  log.section('ROUTES');
  log.check('GET  /api/setup/status', true, 'API key status');
  log.check('POST /api/setup/key', true, 'set + validate API key');
  log.check('POST /api/chat', true, 'streaming SSE');
  log.check('POST /api/voice/transcribe', true, 'whisper');
  log.check('GET  /ws', true, 'WebSocket HUD');

  log.ready(PORT);

  ws.broadcast({
    type: 'status',
    payload: { message: 'JARVIS ONLINE', apiKeyConfigured: hasKey },
    timestamp: Date.now(),
  });
}

main().catch((err) => {
  log.error('STARTUP', String(err));
  process.exit(1);
});
