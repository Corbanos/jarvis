/**
 * Where JARVIS sends its thinking.
 *
 * Default is Anthropic. The operator can instead point the whole system at a
 * local Ollama box (Settings → MODEL ROUTING), which keeps every chat, agent
 * and tool loop on their own hardware. Persisted to ~/.jarvis/config.json so
 * the choice survives restarts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from './logger.js';
import { isConfigured as openaiConfigured } from './openai-auth.js';

const CONFIG_DIR = join(homedir(), '.jarvis');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export type Provider = 'anthropic' | 'ollama' | 'openai';

export interface ModelRouting {
  provider: Provider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  /**
   * Last model list seen on the Ollama host. Cached so the HUD's model dropdown
   * and /api/model stay populated when the box is briefly unreachable — the
   * operator re-probes to refresh it.
   */
  ollamaModelsCache: string[];
  /** OpenAI model id, used with ChatGPT sign-in or OPENAI_API_KEY. */
  openaiModel: string;
  openaiModelsCache: string[];
}

const DEFAULTS: ModelRouting = {
  provider: 'anthropic',
  ollamaBaseUrl: '',
  ollamaModel: '',
  ollamaModelsCache: [],
  openaiModel: 'gpt-6-astra', // the Codex backend's top-priority model as of 2026-09
  openaiModelsCache: [],
};

function readFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

let cached: ModelRouting | null = null;

export function getRouting(): ModelRouting {
  if (cached) return cached;
  const cfg = readFile();
  const raw = (cfg['modelRouting'] ?? {}) as Partial<ModelRouting>;
  cached = {
    provider: raw.provider === 'ollama' ? 'ollama' : raw.provider === 'openai' ? 'openai' : 'anthropic',
    ollamaBaseUrl: typeof raw.ollamaBaseUrl === 'string' ? raw.ollamaBaseUrl : '',
    ollamaModel: typeof raw.ollamaModel === 'string' ? raw.ollamaModel : '',
    ollamaModelsCache: Array.isArray(raw.ollamaModelsCache) ? raw.ollamaModelsCache : [],
    openaiModel: typeof raw.openaiModel === 'string' && raw.openaiModel ? raw.openaiModel : DEFAULTS.openaiModel,
    openaiModelsCache: Array.isArray(raw.openaiModelsCache) ? raw.openaiModelsCache : [],
  };
  // Env override wins, for headless boxes provisioned by config management.
  const envUrl = process.env['JARVIS_OLLAMA_URL'];
  if (envUrl) {
    cached.provider = 'ollama';
    cached.ollamaBaseUrl = envUrl;
    if (process.env['JARVIS_OLLAMA_MODEL']) cached.ollamaModel = process.env['JARVIS_OLLAMA_MODEL']!;
  }
  return cached;
}

export function setRouting(patch: Partial<ModelRouting>): ModelRouting {
  const next: ModelRouting = { ...getRouting(), ...patch };
  cached = next;

  mkdirSync(CONFIG_DIR, { recursive: true });
  const cfg = readFile();
  cfg['modelRouting'] = next;
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');

  log.info(
    next.provider === 'ollama'
      ? `Model routing → Ollama ${next.ollamaBaseUrl} (${next.ollamaModel || 'no model selected'})`
      : next.provider === 'openai'
        ? `Model routing → OpenAI (${next.openaiModel})`
        : 'Model routing → Anthropic'
  );
  return next;
}

/** True only when Ollama is selected AND fully configured. */
export function usingOllama(): boolean {
  const r = getRouting();
  return r.provider === 'ollama' && !!r.ollamaBaseUrl && !!r.ollamaModel;
}

/** True only when OpenAI is selected AND a ChatGPT sign-in or API key exists. */
export function usingOpenAI(): boolean {
  return getRouting().provider === 'openai' && openaiConfigured();
}
