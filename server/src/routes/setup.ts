import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';

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
}
