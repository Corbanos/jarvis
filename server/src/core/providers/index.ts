/**
 * One streaming call, any provider.
 *
 * Both backends return Anthropic-shaped content blocks, so the agentic loops in
 * jarvis.ts and agent-pool.ts stay provider-agnostic: they push `content` onto
 * the history and branch on `stop_reason` exactly as before.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getRouting } from '../model-routing.js';
import { streamOllama, type ProviderResult } from './ollama.js';
import { streamOpenAI } from './openai.js';

export type { ProviderResult } from './ollama.js';

export interface StreamChatOpts {
  /** Anthropic model id. Ignored when routing is set to Ollama. */
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens?: number;
  onText?: (token: string) => void;
  signal?: AbortSignal;
}

/** The model that will actually serve the next turn, for logs and the HUD. */
export function effectiveModel(requested: string): string {
  const r = getRouting();
  if (r.provider === 'ollama' && r.ollamaBaseUrl && r.ollamaModel) return r.ollamaModel;
  if (r.provider === 'openai') return r.openaiModel;
  return requested;
}

async function streamAnthropic(opts: StreamChatOpts): Promise<ProviderResult> {
  // Constructed per call rather than at startup: the operator can paste an API
  // key into the setup screen mid-session, and this picks it up immediately.
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  const stream = client.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    tools: opts.tools,
    messages: opts.messages,
  });

  if (opts.onText) stream.on('text', (t: string) => opts.onText!(t));
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => stream.abort(), { once: true });
  }

  const final = await stream.finalMessage();
  return {
    content: final.content as unknown as Anthropic.ContentBlockParam[],
    stop_reason: final.stop_reason ?? 'end_turn',
  };
}

export async function streamChat(opts: StreamChatOpts): Promise<ProviderResult> {
  const r = getRouting();

  if (r.provider === 'ollama') {
    if (!r.ollamaBaseUrl) throw new Error('Ollama routing is on but no host is configured.');
    if (!r.ollamaModel) throw new Error('Ollama routing is on but no model is selected.');
    return streamOllama({
      baseUrl: r.ollamaBaseUrl,
      model: r.ollamaModel,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.onText ? { onText: opts.onText } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  if (r.provider === 'openai') {
    return streamOpenAI({
      model: r.openaiModel,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.onText ? { onText: opts.onText } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  return streamAnthropic(opts);
}
