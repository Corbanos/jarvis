export type AIProvider = 'anthropic' | 'gemini';

export const ANTHROPIC_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
] as const;

export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
] as const;

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: ANTHROPIC_MODELS[1],
  gemini: GEMINI_MODELS[0],
};

function parseProvider(value: string | undefined): AIProvider | undefined {
  if (value === 'anthropic' || value === 'gemini') return value;
  return undefined;
}

let currentProvider: AIProvider = parseProvider(process.env['AI_PROVIDER']) ?? 'anthropic';
const currentModels: Record<AIProvider, string> = {
  anthropic: process.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODELS.anthropic,
  gemini: process.env['GEMINI_MODEL'] ?? DEFAULT_MODELS.gemini,
};

export function getCurrentProvider(): AIProvider {
  return currentProvider;
}

export function setCurrentProvider(provider: AIProvider): void {
  currentProvider = provider;
  process.env['AI_PROVIDER'] = provider;
}

export function getAvailableModels(provider: AIProvider = currentProvider): string[] {
  return provider === 'anthropic' ? [...ANTHROPIC_MODELS] : [...GEMINI_MODELS];
}

function looksLikeProviderModel(provider: AIProvider, model: string): boolean {
  if (!model.trim()) return false;
  if (provider === 'anthropic') return model.startsWith('claude-');
  return model.startsWith('gemini');
}

export function getCurrentModel(provider: AIProvider = currentProvider): string {
  return currentModels[provider];
}

export function setCurrentModel(model: string, provider: AIProvider = currentProvider): boolean {
  if (!looksLikeProviderModel(provider, model)) return false;
  currentModels[provider] = model;
  if (provider === 'anthropic') {
    process.env['ANTHROPIC_MODEL'] = model;
  } else {
    process.env['GEMINI_MODEL'] = model;
  }
  return true;
}

export function getProviderApiKey(provider: AIProvider): string | undefined {
  if (provider === 'anthropic') return process.env['ANTHROPIC_API_KEY'];
  return process.env['GEMINI_API_KEY'];
}
