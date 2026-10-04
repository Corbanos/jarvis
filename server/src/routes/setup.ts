import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import {
  getCurrentModel,
  getCurrentProvider,
  getProviderApiKey,
  setCurrentModel,
  setCurrentProvider,
  type AIProvider,
} from '../core/ai-provider.js';

const CONFIG_DIR = join(homedir(), '.jarvis');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface JarvisConfig {
  aiProvider?: AIProvider;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  anthropicModel?: string;
  geminiModel?: string;
}

function parseProvider(value: string | undefined): AIProvider | undefined {
  if (value === 'anthropic' || value === 'gemini') return value;
  return undefined;
}

function keyField(provider: AIProvider): 'anthropicApiKey' | 'geminiApiKey' {
  return provider === 'anthropic' ? 'anthropicApiKey' : 'geminiApiKey';
}

function modelField(provider: AIProvider): 'anthropicModel' | 'geminiModel' {
  return provider === 'anthropic' ? 'anthropicModel' : 'geminiModel';
}

function envKeyField(provider: AIProvider): 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY';
}

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

function looksLikeKey(provider: AIProvider, key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (provider === 'anthropic') return trimmed.startsWith('sk-ant-') && trimmed.length > 20;
  return trimmed.length > 20;
}

function getConfigProvider(): AIProvider {
  return parseProvider(process.env['AI_PROVIDER']) ?? parseProvider(loadConfig().aiProvider) ?? 'anthropic';
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

export function applySavedConfig() {
  const config = loadConfig();
  const provider = parseProvider(process.env['AI_PROVIDER']) ?? parseProvider(config.aiProvider) ?? 'anthropic';
  setCurrentProvider(provider);

  if (!process.env['ANTHROPIC_API_KEY'] && config.anthropicApiKey) process.env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
  if (!process.env['GEMINI_API_KEY'] && config.geminiApiKey) process.env['GEMINI_API_KEY'] = config.geminiApiKey;

  const anthModel = process.env['ANTHROPIC_MODEL'] ?? config.anthropicModel;
  const geminiModel = process.env['GEMINI_MODEL'] ?? config.geminiModel;
  if (anthModel) setCurrentModel(anthModel, 'anthropic');
  if (geminiModel) setCurrentModel(geminiModel, 'gemini');
}

export function getApiKey(provider: AIProvider = getConfigProvider()): string | undefined {
  const fromEnv = getProviderApiKey(provider);
  if (fromEnv) return fromEnv;
  const config = loadConfig();
  return provider === 'anthropic' ? config.anthropicApiKey : config.geminiApiKey;
}

function applyProviderConfig(provider: AIProvider, key: string, model?: string) {
  const envKey = envKeyField(provider);
  process.env[envKey] = key;
  setCurrentProvider(provider);
  const updates: JarvisConfig = { aiProvider: provider, [keyField(provider)]: key };
  if (model && setCurrentModel(model, provider)) updates[modelField(provider)] = model;
  saveConfig(updates);
}

async function testApiKey(provider: AIProvider, key: string, model: string): Promise<{ valid: boolean; error?: string; model: string }> {
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ONLINE' }],
      });
      return { valid: true, model };
    }

    const client = new GoogleGenAI({ apiKey: key });
    await client.models.generateContent({
      model,
      contents: 'Reply with the single word: ONLINE',
    });
    return { valid: true, model };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 401) return { valid: false, error: 'Invalid API key — authentication failed.', model };
    if (e.status === 429) return { valid: false, error: 'Rate limited. Key is valid but quota exceeded.', model };
    return { valid: false, error: e.message ?? String(err), model };
  }
}

export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async (_req, reply) => {
    const provider = getCurrentProvider();
    const model = getCurrentModel(provider);
    const key = getApiKey(provider);
    if (!key) return reply.send({ configured: false, valid: false, provider, model });
    return reply.send({
      configured: true,
      valid: looksLikeKey(provider, key),
      provider,
      model,
      preview: maskKey(key),
    });
  });

  app.post('/api/setup/key', async (request, reply) => {
    const body = request.body as { key: string; provider?: AIProvider; model?: string };
    const provider = parseProvider(body.provider) ?? getConfigProvider();
    const key = body.key?.trim();

    if (!key) return reply.status(400).send({ error: 'No key provided' });

    const model = body.model?.trim() || getCurrentModel(provider);
    if (!setCurrentModel(model, provider)) {
      return reply.status(400).send({ valid: false, error: `Invalid model for ${provider}`, provider });
    }

    log.info(`Testing ${provider} API key: ${maskKey(key)}`);
    const result = await testApiKey(provider, key, model);

    if (result.valid) {
      applyProviderConfig(provider, key, result.model);
      log.check(`${provider} API Key`, true, `Validated + saved (${maskKey(key)})`);
      return reply.send({ ...result, provider, preview: maskKey(key) });
    }

    log.warn(`${provider} API Key`, result.error ?? 'Validation failed');
    return reply.send({ ...result, provider });
  });

  app.delete('/api/setup/key', async (request, reply) => {
    const query = request.query as { provider?: string };
    const provider = parseProvider(query.provider) ?? getCurrentProvider();
    process.env[envKeyField(provider)] = '';
    saveConfig({ [keyField(provider)]: undefined });
    return reply.send({ ok: true, provider });
  });
}
