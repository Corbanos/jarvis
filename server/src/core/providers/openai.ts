/**
 * OpenAI adapter — Responses API over SSE, presented in Anthropic's
 * content-block shape so the agentic loops don't care which provider is live.
 *
 * With `store: false` (required on the ChatGPT backend) nothing persists
 * server-side, so reasoning items that precede a function call are cached
 * here and echoed back with the tool results — reasoning models reject a
 * function_call whose reasoning is missing from the history.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { resolveRequestAuth } from '../openai-auth.js';
import type { ProviderResult } from './ollama.js';

/** The Codex backend's top-priority model for ChatGPT accounts, observed 2026-09. */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-astra';

/**
 * Shown when the account's model list can't be fetched — what the Codex
 * backend listed for a ChatGPT account on 2026-09-02, in its own priority
 * order. Any id can still be typed.
 */
export const CURATED_OPENAI_MODELS = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini'];

/**
 * The Codex backend gates its model list by the client version presented;
 * older versions see only older models. Anything ≥ the newest model's
 * minimal_client_version works — this is well past it.
 */
const CODEX_CLIENT_VERSION = process.env['JARVIS_CODEX_CLIENT_VERSION'] ?? '1.0.0';

/** Everything current reasons; only the gpt-4 line does not. */
const isReasoningModel = (m: string) => !/^gpt-4/i.test(m);

// ── reasoning echo cache ──────────────────────────────────────────────────

const reasoningByCallId = new Map<string, unknown[]>();
const REASONING_CACHE_MAX = 1000;

function rememberReasoning(callIds: string[], items: unknown[]): void {
  if (!items.length) return;
  for (const id of callIds) {
    reasoningByCallId.set(id, items);
    if (reasoningByCallId.size > REASONING_CACHE_MAX) {
      const oldest = reasoningByCallId.keys().next().value;
      if (oldest !== undefined) reasoningByCallId.delete(oldest);
    }
  }
}

function reasoningFor(callIds: string[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const id of callIds) {
    for (const item of reasoningByCallId.get(id) ?? []) {
      const key = (item as { id?: string }).id ?? JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** Test seam. */
export function _resetReasoningCache(): void { reasoningByCallId.clear(); }

// ── Anthropic → Responses shaping ─────────────────────────────────────────

function blocksText(blocks: Array<Record<string, unknown>>): string {
  return blocks.filter((b) => b['type'] === 'text').map((b) => String(b['text'] ?? '')).join('');
}

export function toResponsesInput(messages: Anthropic.MessageParam[], reasoning: (callIds: string[]) => unknown[] = reasoningFor): unknown[] {
  const input: unknown[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      input.push(m.role === 'assistant'
        ? { role: 'assistant', content: [{ type: 'output_text', text: m.content }] }
        : { role: 'user', content: [{ type: 'input_text', text: m.content }] });
      continue;
    }
    const blocks = m.content as unknown as Array<Record<string, unknown>>;
    if (m.role === 'assistant') {
      const text = blocksText(blocks);
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      const calls = blocks.filter((b) => b['type'] === 'tool_use');
      if (calls.length) {
        input.push(...reasoning(calls.map((c) => String(c['id']))));
        for (const c of calls) {
          input.push({ type: 'function_call', call_id: String(c['id']), name: String(c['name']), arguments: JSON.stringify(c['input'] ?? {}) });
        }
      }
      continue;
    }
    const results = blocks.filter((b) => b['type'] === 'tool_result');
    for (const r of results) {
      const raw = r['content'];
      const output = typeof raw === 'string' ? raw : Array.isArray(raw) ? blocksText(raw as Array<Record<string, unknown>>) : JSON.stringify(raw ?? '');
      input.push({ type: 'function_call_output', call_id: String(r['tool_use_id']), output });
    }
    const text = blocksText(blocks);
    if (text) input.push({ role: 'user', content: [{ type: 'input_text', text }] });
  }
  return input;
}

export function toResponsesTools(tools: Anthropic.Tool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema ?? { type: 'object', properties: {} },
    strict: false,
  }));
}

// ── SSE parsing ───────────────────────────────────────────────────────────

export interface ParsedStream {
  text: string;
  toolCalls: Array<{ callId: string; name: string; input: Record<string, unknown> }>;
  reasoning: unknown[];
  status: 'completed' | 'incomplete' | 'failed';
  incompleteReason?: string;
  error?: string;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } }
  return {};
}

export async function parseResponsesSSE(body: ReadableStream<Uint8Array>, onText?: (t: string) => void): Promise<ParsedStream> {
  const out: ParsedStream = { text: '', toolCalls: [], reasoning: [], status: 'completed' };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDelta = false;
  let messageText = '';

  const handle = (ev: Record<string, unknown>) => {
    const type = String(ev['type'] ?? '');
    if (type === 'response.output_text.delta') {
      const d = String(ev['delta'] ?? '');
      if (d) { sawDelta = true; out.text += d; onText?.(d); }
    } else if (type === 'response.output_item.done') {
      const item = ev['item'] as Record<string, unknown> | undefined;
      if (!item) return;
      if (item['type'] === 'function_call') {
        out.toolCalls.push({ callId: String(item['call_id'] ?? item['id'] ?? ''), name: String(item['name'] ?? ''), input: parseArgs(item['arguments']) });
      } else if (item['type'] === 'reasoning') {
        out.reasoning.push(item);
      } else if (item['type'] === 'message') {
        const parts = (item['content'] as Array<Record<string, unknown>> | undefined) ?? [];
        messageText += parts.filter((p) => p['type'] === 'output_text').map((p) => String(p['text'] ?? '')).join('');
      }
    } else if (type === 'response.incomplete') {
      const r = ev['response'] as { incomplete_details?: { reason?: string } } | undefined;
      out.status = 'incomplete';
      out.incompleteReason = r?.incomplete_details?.reason;
    } else if (type === 'response.failed') {
      const r = ev['response'] as { error?: { message?: string } } | undefined;
      out.status = 'failed';
      out.error = r?.error?.message ?? 'response failed';
    } else if (type === 'error') {
      out.status = 'failed';
      const e = ev['error'] as { message?: string } | undefined;
      out.error = e?.message ?? (typeof ev['message'] === 'string' ? ev['message'] : 'stream error');
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { handle(JSON.parse(data) as Record<string, unknown>); } catch { /* partial or non-JSON frame */ }
    }
  }
  // A server that sends whole message items but no deltas still yields text.
  if (!sawDelta && messageText) { out.text = messageText; onText?.(messageText); }
  return out;
}

// ── The call ──────────────────────────────────────────────────────────────

export interface OpenAIStreamOpts {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens?: number;
  onText?: (t: string) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

async function describeHttpError(res: Response, source: string): Promise<string> {
  const body = await res.text().catch(() => '');
  let detail = '';
  try { detail = (JSON.parse(body) as { error?: { message?: string }; detail?: string }).error?.message ?? (JSON.parse(body) as { detail?: string }).detail ?? ''; } catch { detail = body.slice(0, 200); }
  if (res.status === 401) return `OpenAI rejected the ${source === 'chatgpt' ? 'ChatGPT sign-in' : 'API key'} (401)${detail ? `: ${detail}` : ''}. Sign in again under MODEL ROUTING.`;
  if (res.status === 403) return `OpenAI refused the request (403)${detail ? `: ${detail}` : ''} — this ChatGPT plan may not include Codex access.`;
  if (res.status === 429) return `OpenAI rate/usage limit reached (429)${detail ? `: ${detail}` : ''}.`;
  return `OpenAI responded ${res.status}${detail ? `: ${detail}` : ''}`;
}

/**
 * The two backends accept different parameter sets. The Codex backend rejects
 * max_output_tokens outright and applies its own per-model reasoning defaults,
 * so for ChatGPT auth the body is the minimal shape the Codex CLI sends; the
 * platform API gets the fuller one.
 */
export function buildResponsesBody(opts: OpenAIStreamOpts, source: 'chatgpt' | 'apikey'): Record<string, unknown> {
  const reasoning = isReasoningModel(opts.model);
  return {
    model: opts.model,
    instructions: opts.system,
    input: toResponsesInput(opts.messages),
    ...(opts.tools.length ? { tools: toResponsesTools(opts.tools), tool_choice: 'auto', parallel_tool_calls: true } : {}),
    store: false,
    stream: true,
    ...(reasoning ? { include: ['reasoning.encrypted_content'] } : {}),
    ...(source === 'apikey' && opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
    ...(source === 'apikey' && reasoning ? { reasoning: { effort: 'medium', summary: 'auto' } } : {}),
  };
}

export async function streamOpenAI(opts: OpenAIStreamOpts): Promise<ProviderResult> {
  const f = opts.fetch ?? fetch;

  const send = async (forceRefresh: boolean) => {
    const auth = await resolveRequestAuth(f, forceRefresh);
    const res = await f(`${auth.baseUrl}/responses`, {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(buildResponsesBody(opts, auth.source)),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { auth, res };
  };

  let { auth, res } = await send(false);
  // A stale ChatGPT token: one forced refresh (inside resolveRequestAuth), one retry.
  if (res.status === 401 && auth.source === 'chatgpt') {
    ({ auth, res } = await send(true));
  }
  if (!res.ok || !res.body) throw new Error(await describeHttpError(res, auth.source));

  const parsed = await parseResponsesSSE(res.body, opts.onText);
  if (parsed.status === 'failed') throw new Error(`OpenAI: ${parsed.error ?? 'response failed'}`);

  const content: Anthropic.ContentBlockParam[] = [];
  if (parsed.text) content.push({ type: 'text', text: parsed.text });
  for (const tc of parsed.toolCalls) content.push({ type: 'tool_use', id: tc.callId, name: tc.name, input: tc.input });
  rememberReasoning(parsed.toolCalls.map((t) => t.callId), parsed.reasoning);

  const stop_reason = parsed.toolCalls.length
    ? 'tool_use'
    : parsed.status === 'incomplete' && parsed.incompleteReason === 'max_output_tokens'
      ? 'max_tokens'
      : 'end_turn';
  return { content, stop_reason };
}

// ── Model list ────────────────────────────────────────────────────────────

interface CodexModel { slug?: string; visibility?: string; priority?: number; display_name?: string }

/** Pure: the Codex backend's list → operator-facing ids, hidden ones dropped, in the backend's priority order. */
export function pickCodexModels(models: CodexModel[]): string[] {
  return models
    .filter((m) => typeof m.slug === 'string' && (m.visibility ?? 'list') === 'list')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((m) => m.slug!);
}

/** The account's models if the backend will list them; the curated set otherwise. */
export async function listOpenAIModels(f: typeof fetch = fetch): Promise<{ models: string[]; source: 'remote' | 'curated' }> {
  try {
    const auth = await resolveRequestAuth(f);
    // The Codex backend requires client_version and filters the list by it;
    // the platform API takes no params and answers with `data`.
    const url = auth.source === 'chatgpt' ? `${auth.baseUrl}/models?client_version=${CODEX_CLIENT_VERSION}` : `${auth.baseUrl}/models`;
    const res = await f(url, { headers: { ...auth.headers, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = (await res.json()) as { models?: CodexModel[]; data?: Array<{ id?: string }> };
      const ids = auth.source === 'chatgpt'
        ? pickCodexModels(j.models ?? [])
        : (j.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string' && /^(gpt-|o\d|codex)/i.test(x)).sort();
      if (ids.length) return { models: ids, source: 'remote' };
    }
  } catch { /* fall back */ }
  return { models: CURATED_OPENAI_MODELS, source: 'curated' };
}
