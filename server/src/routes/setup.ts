import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { getRouting, setRouting, usingOllama, usingOpenAI, type Provider } from '../core/model-routing.js';
import * as openaiAuth from '../core/openai-auth.js';
import { listOpenAIModels, CURATED_OPENAI_MODELS } from '../core/providers/openai.js';
import { probeOllama, normalizeBaseUrl } from '../core/providers/ollama.js';

const CONFIG_DIR = join(homedir(), '.jarvis');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface JarvisConfig {
  anthropicApiKey?: string;
}

export function loadConfig(): JarvisConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as JarvisConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: JarvisConfig) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadConfig();
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...config }, null, 2), 'utf-8');
}

export function getApiKey(): string | undefined {
  // Priority: env var > config file
  return process.env['ANTHROPIC_API_KEY'] || loadConfig().anthropicApiKey;
}

export function applyApiKey(key: string) {
  process.env['ANTHROPIC_API_KEY'] = key;
  saveConfig({ anthropicApiKey: key });
}

async function testApiKey(key: string): Promise<{ valid: boolean; error?: string; model?: string }> {
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ONLINE' }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    return { valid: true, model: 'claude-haiku-4-5' };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 401) return { valid: false, error: 'Invalid API key — authentication failed.' };
    if (e.status === 429) return { valid: false, error: 'Rate limited. Key is valid but quota exceeded.' };
    return { valid: false, error: e.message ?? String(err) };
  }
}

export async function setupRoutes(app: FastifyInstance) {
  // Check current key status
  app.get('/api/setup/status', async (_req, reply) => {
    // A local model needs no Anthropic key — don't gate the HUD on one.
    if (usingOllama()) {
      const r = getRouting();
      return reply.send({ configured: true, valid: true, provider: 'ollama', preview: r.ollamaModel });
    }
    if (usingOpenAI()) {
      return reply.send({ configured: true, valid: true, provider: 'openai', preview: getRouting().openaiModel });
    }

    const key = getApiKey();
    if (!key) return reply.send({ configured: false, valid: false });

    // Quick format check before hitting the API
    const looksValid = key.startsWith('sk-ant-') && key.length > 40;
    if (!looksValid) return reply.send({ configured: true, valid: false, error: 'Key format invalid' });

    return reply.send({ configured: true, valid: true, preview: `sk-...${key.slice(-4)}` });
  });

  // Submit + test a new key
  app.post('/api/setup/key', async (request, reply) => {
    const body = request.body as { key: string };
    const key = body.key?.trim();

    if (!key) return reply.status(400).send({ error: 'No key provided' });
    if (!key.startsWith('sk-ant-')) {
      return reply.send({ valid: false, error: 'Key must start with sk-ant-  — make sure you copied the full key from console.anthropic.com' });
    }

    log.info(`Testing API key: sk-...${key.slice(-4)}`);

    const result = await testApiKey(key);

    if (result.valid) {
      applyApiKey(key);
      log.check('API Key', true, `Validated + saved (sk-...${key.slice(-4)})`);
    } else {
      log.warn('API Key', result.error ?? 'Validation failed');
    }

    return reply.send(result);
  });

  // Clear key (for reset)
  app.delete('/api/setup/key', async (_req, reply) => {
    process.env['ANTHROPIC_API_KEY'] = '';
    saveConfig({ anthropicApiKey: undefined });
    return reply.send({ ok: true });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Model routing — Anthropic or a local Ollama host
  // ─────────────────────────────────────────────────────────────────────

  // Current routing config, plus the last-seen model list so the HUD can
  // render the picker before the operator re-probes.
  app.get('/api/setup/provider', async (_req, reply) => {
    const r = getRouting();
    return reply.send({
      provider: r.provider,
      ollamaBaseUrl: r.ollamaBaseUrl,
      ollamaModel: r.ollamaModel,
      models: r.ollamaModelsCache,
      openaiModel: r.openaiModel,
      openaiModels: r.openaiModelsCache.length ? r.openaiModelsCache : CURATED_OPENAI_MODELS,
      openai: openaiAuth.getAuthStatus(),
      active: usingOllama() ? 'ollama' : usingOpenAI() ? 'openai' : 'anthropic',
      anthropicConfigured: !!getApiKey(),
    });
  });

  // Reach out to an Ollama host and list what it has pulled. Read-only —
  // changes no config, so the operator can check an address before committing.
  app.post('/api/setup/provider/probe', async (request, reply) => {
    const body = request.body as { baseUrl?: string };
    const result = await probeOllama(body.baseUrl ?? '');

    if (result.ok) {
      log.check('Ollama', true, `${result.baseUrl} — ${result.models?.length ?? 0} model(s)`);
      // Cache the list so the picker survives the box going offline.
      setRouting({ ollamaModelsCache: (result.models ?? []).map((m) => m.name) });
    } else {
      log.warn('Ollama', result.error ?? 'probe failed');
    }

    return reply.send(result);
  });

  // Commit a routing choice.
  app.post('/api/setup/provider', async (request, reply) => {
    const body = request.body as { provider?: Provider; ollamaBaseUrl?: string; ollamaModel?: string; openaiModel?: string };
    const provider: Provider = body.provider === 'ollama' ? 'ollama' : body.provider === 'openai' ? 'openai' : 'anthropic';

    if (provider === 'openai') {
      if (!openaiAuth.isConfigured()) {
        return reply.status(400).send({ error: 'Sign in with ChatGPT first, or set OPENAI_API_KEY in .env.' });
      }
      const model = (body.openaiModel ?? '').trim() || getRouting().openaiModel;
      const saved = setRouting({ provider, openaiModel: model });
      return reply.send({ ok: true, provider: saved.provider, openaiModel: saved.openaiModel });
    }

    if (provider === 'ollama') {
      const baseUrl = normalizeBaseUrl(body.ollamaBaseUrl ?? getRouting().ollamaBaseUrl);
      const model = (body.ollamaModel ?? '').trim() || getRouting().ollamaModel;
      if (!baseUrl) return reply.status(400).send({ error: 'An Ollama host is required, e.g. 192.168.1.50:11434' });
      if (!model) return reply.status(400).send({ error: 'Pick a model from the host first' });

      // Verify the host still has that model rather than failing on first chat.
      const probe = await probeOllama(baseUrl);
      if (!probe.ok) return reply.status(400).send({ error: probe.error ?? 'Ollama unreachable' });
      const names = (probe.models ?? []).map((m) => m.name);
      if (!names.includes(model)) {
        return reply.status(400).send({ error: `${baseUrl} has no model named "${model}". Available: ${names.join(', ') || 'none'}` });
      }

      const saved = setRouting({ provider, ollamaBaseUrl: baseUrl, ollamaModel: model, ollamaModelsCache: names });
      return reply.send({ ok: true, provider: saved.provider, ollamaBaseUrl: saved.ollamaBaseUrl, ollamaModel: saved.ollamaModel, models: names });
    }

    const saved = setRouting({ provider: 'anthropic' });
    return reply.send({ ok: true, provider: saved.provider });
  });

  // ─────────────────────────────────────────────────────────────────────
  // OpenAI account — ChatGPT sign-in (Codex OAuth) or OPENAI_API_KEY
  // ─────────────────────────────────────────────────────────────────────

  app.get('/api/setup/openai/status', async (_req, reply) => reply.send(openaiAuth.getAuthStatus()));

  // Begins the PKCE flow. The HUD opens `url`; the callback lands on this
  // machine's :1455 (or the operator pastes the URL back from another device).
  app.post('/api/setup/openai/login/start', async (_req, reply) => {
    const r = await openaiAuth.startLogin();
    log.info(`OpenAI sign-in started (${r.listening ? 'listening on ' + r.redirectUri : 'paste-back only'})`);
    return reply.send(r);
  });

  app.get('/api/setup/openai/login/status', async (_req, reply) => reply.send(openaiAuth.loginStatus()));

  app.post('/api/setup/openai/login/complete', async (request, reply) => {
    const body = request.body as { url?: string };
    const r = await openaiAuth.completeLoginFromUrl(body.url ?? '');
    return reply.status(r.ok ? 200 : 400).send(r);
  });

  app.post('/api/setup/openai/import', async (_req, reply) => {
    const t = openaiAuth.importFromCodex();
    if (!t) return reply.status(404).send({ error: 'No Codex CLI sign-in found at ~/.codex/auth.json — run `codex login` there, or sign in here.' });
    return reply.send({ ok: true, status: openaiAuth.getAuthStatus() });
  });

  app.post('/api/setup/openai/logout', async (_req, reply) => {
    openaiAuth.signOut();
    if (getRouting().provider === 'openai' && !openaiAuth.isConfigured()) setRouting({ provider: 'anthropic' });
    return reply.send({ ok: true, status: openaiAuth.getAuthStatus() });
  });

  app.get('/api/setup/openai/models', async (_req, reply) => {
    if (!openaiAuth.isConfigured()) return reply.status(412).send({ error: 'Not signed in.' });
    const r = await listOpenAIModels();
    if (r.source === 'remote') setRouting({ openaiModelsCache: r.models });
    return reply.send(r);
  });
}
