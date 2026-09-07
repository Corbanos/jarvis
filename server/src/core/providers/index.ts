/**
 * One streaming call, any provider.
 *
 * Both backends return Anthropic-shaped content blocks, so the agentic loops in
 * jarvis.ts and agent-pool.ts stay provider-agnostic: they push `content` onto
 * the history and branch on `stop_reason` exactly as before.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getRouting, type Effort } from '../model-routing.js';
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

type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Which effort levels a Claude model accepts. Haiku 4.5 rejects the parameter
 * (and adaptive thinking); the 4.6 line predates xhigh; everything newer takes
 * all five. Sending an unsupported level is a 400, so clamp rather than fail.
 */
export function anthropicThinkingParams(model: string, effort: Effort): { thinking?: { type: 'adaptive' }; output_config?: { effort: AnthropicEffort } } {
  if (effort === 'default') return {};
  if (/haiku/i.test(model)) return {};
  let level: AnthropicEffort = effort;
  if (/-4-6/.test(model) && level === 'xhigh') level = 'high';
  return { thinking: { type: 'adaptive' }, output_config: { effort: level } };
}

async function streamAnthropic(opts: StreamChatOpts, effort: Effort): Promise<ProviderResult> {
  // Constructed per call rather than at startup: the operator can paste an API
  // key into the setup screen mid-session, and this picks it up immediately.
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  const thinking = anthropicThinkingParams(opts.model, effort);
  const stream = client.messages.stream({
    model: opts.model,
    // Thinking tokens count against max_tokens; give an explicit level room so
    // a deep think doesn't truncate the visible reply.
    max_tokens: Math.max(opts.maxTokens ?? 8192, thinking.thinking ? 32_000 : 0),
    system: opts.system,
    tools: opts.tools,
    messages: opts.messages,
    ...thinking,
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
      effort: r.effort,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.onText ? { onText: opts.onText } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  return streamAnthropic(opts, r.effort);
}
