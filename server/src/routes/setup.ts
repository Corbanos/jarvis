import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { getRouting, setRouting, usingOllama, type Provider } from '../core/model-routing.js';
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
      active: usingOllama() ? 'ollama' : 'anthropic',
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
    const body = request.body as { provider?: Provider; ollamaBaseUrl?: string; ollamaModel?: string };
    const provider: Provider = body.provider === 'ollama' ? 'ollama' : 'anthropic';

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
}
