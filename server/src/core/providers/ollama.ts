/**
 * Ollama adapter.
 *
 * Speaks Ollama's native /api/chat protocol but presents results in Anthropic's
 * content-block shape, so the agentic loops in jarvis.ts and agent-pool.ts run
 * unchanged whichever provider is live.
 *
 * Ollama has no notion of a tool_use id — it returns bare function calls — so
 * ids are minted here and threaded back through tool results, which is what
 * keeps multi-turn tool conversations coherent.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';

export interface OllamaModel {
  name: string;
  size: number;
  family: string;
  parameterSize: string;
  quantization: string;
  modifiedAt: string;
}

export interface OllamaProbe {
  ok: boolean;
  baseUrl: string;
  version?: string;
  models?: OllamaModel[];
  error?: string;
}

/**
 * Accepts what an operator would actually type: `192.168.1.50`,
 * `192.168.1.50:11434`, `http://box.local:11434/`. Fills in the scheme and
 * Ollama's default port, and drops any trailing slash.
 */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return '';
  }
  if (!url.port && url.protocol === 'http:') url.port = '11434';
  return `${url.protocol}//${url.host}`;
}

interface TagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    modified_at?: string;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
  }>;
}

/**
 * Reaches out to an Ollama host and lists what it has pulled.
 * Never throws — a bad address is a normal outcome here, reported as `ok: false`.
 */
export async function probeOllama(rawUrl: string, timeoutMs = 6000): Promise<OllamaProbe> {
  const baseUrl = normalizeBaseUrl(rawUrl);
  if (!baseUrl) return { ok: false, baseUrl: '', error: 'Enter a host like 192.168.1.50:11434' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const [tagsRes, verRes] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, { signal: ctl.signal }),
      fetch(`${baseUrl}/api/version`, { signal: ctl.signal }).catch(() => null),
    ]);

    if (!tagsRes.ok) {
      return { ok: false, baseUrl, error: `Ollama responded ${tagsRes.status} ${tagsRes.statusText}` };
    }

    const tags = (await tagsRes.json()) as TagsResponse;
    const version = verRes?.ok ? ((await verRes.json()) as { version?: string }).version : undefined;

    const models: OllamaModel[] = (tags.models ?? []).map((m) => ({
      name: m.name ?? m.model ?? 'unknown',
      size: m.size ?? 0,
      family: m.details?.family ?? '',
      parameterSize: m.details?.parameter_size ?? '',
      quantization: m.details?.quantization_level ?? '',
      modifiedAt: m.modified_at ?? '',
    })).sort((a, b) => a.name.localeCompare(b.name));

    return { ok: true, baseUrl, version: version ?? '', models };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') {
      return { ok: false, baseUrl, error: `No response from ${baseUrl} within ${timeoutMs / 1000}s` };
    }
    return { ok: false, baseUrl, error: describeFetchFailure(err, baseUrl) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns a fetch rejection into something an operator can act on.
 *
 * Node reports every network failure as a bare `TypeError: fetch failed` and
 * buries the real reason in `cause` — which, when a host resolves to several
 * addresses, is an AggregateError holding one error per attempt. Both shapes
 * are unwrapped here so a typo'd address doesn't read as "fetch failed".
 */
function describeFetchFailure(err: unknown, baseUrl: string): string {
  const codes = new Set<string>();
  const seen = new Set<unknown>();

  const walk = (e: unknown, depth: number): void => {
    if (!e || typeof e !== 'object' || depth > 5 || seen.has(e)) return;
    seen.add(e);
    const obj = e as { code?: string; errno?: string; cause?: unknown; errors?: unknown[] };
    if (typeof obj.code === 'string') codes.add(obj.code);
    for (const nested of obj.errors ?? []) walk(nested, depth + 1);
    walk(obj.cause, depth + 1);
  };
  walk(err, 0);

  if (codes.has('ECONNREFUSED')) {
    return `Connection refused at ${baseUrl} — Ollama listens on loopback by default; start it with OLLAMA_HOST=0.0.0.0 ollama serve.`;
  }
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) {
    return `Host not found: ${baseUrl} — check the address spelling.`;
  }
  if (codes.has('ETIMEDOUT') || codes.has('EHOSTUNREACH') || codes.has('ENETUNREACH')) {
    return `${baseUrl} is unreachable from this machine — check they're on the same network.`;
  }
  if (codes.has('ECONNRESET')) {
    return `Connection reset by ${baseUrl}.`;
  }

  const message = (err as { message?: string }).message ?? String(err);
  // "fetch failed" alone tells the operator nothing; say where it failed.
  return message === 'fetch failed' ? `Could not reach ${baseUrl}.` : message;
}

// ── Anthropic → Ollama request shaping ──────────────────────────────

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

function blocksToText(blocks: Array<Record<string, unknown>>): string {
  return blocks
    .filter((b) => b['type'] === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('');
}

/**
 * Flattens Anthropic's block-structured history into Ollama's flat message list.
 * tool_use blocks become assistant tool_calls; tool_result blocks become
 * separate `tool` messages, which is how Ollama expects results to come back.
 */
export function toOllamaMessages(
  system: string,
  messages: Anthropic.MessageParam[]
): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  // tool_use id -> tool name, so tool results can be attributed on the way back.
  const toolNameById = new Map<string, string>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    const blocks = msg.content as unknown as Array<Record<string, unknown>>;

    if (msg.role === 'assistant') {
      const toolUses = blocks.filter((b) => b['type'] === 'tool_use');
      for (const tu of toolUses) {
        toolNameById.set(String(tu['id']), String(tu['name']));
      }
      const entry: OllamaMessage = { role: 'assistant', content: blocksToText(blocks) };
      if (toolUses.length) {
        entry.tool_calls = toolUses.map((tu) => ({
          function: {
            name: String(tu['name']),
            arguments: (tu['input'] as Record<string, unknown>) ?? {},
          },
        }));
      }
      out.push(entry);
      continue;
    }

    // A user turn carrying tool results becomes one `tool` message per result.
    const results = blocks.filter((b) => b['type'] === 'tool_result');
    if (results.length) {
      for (const r of results) {
        const raw = r['content'];
        const content = typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? blocksToText(raw as Array<Record<string, unknown>>)
            : JSON.stringify(raw ?? '');
        const name = toolNameById.get(String(r['tool_use_id']));
        out.push({ role: 'tool', content, ...(name ? { tool_name: name } : {}) });
      }
      const text = blocksToText(blocks);
      if (text) out.push({ role: 'user', content: text });
      continue;
    }

    out.push({ role: 'user', content: blocksToText(blocks) });
  }

  return out;
}

export function toOllamaTools(tools: Anthropic.Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    },
  }));
}

// ── Streaming chat ──────────────────────────────────────────────────

export interface OllamaStreamOpts {
  baseUrl: string;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens?: number;
  onText?: (token: string) => void;
  signal?: AbortSignal;
}

export interface ProviderResult {
  content: Anthropic.ContentBlockParam[];
  stop_reason: string;
}

interface OllamaChunk {
  message?: {
    content?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

/**
 * Streams one assistant turn from Ollama, emitting text tokens as they arrive
 * and returning the completed turn as Anthropic content blocks.
 */
export async function streamOllama(opts: OllamaStreamOpts): Promise<ProviderResult> {
  const body = {
    model: opts.model,
    messages: toOllamaMessages(opts.system, opts.messages),
    stream: true,
    ...(opts.tools.length ? { tools: toOllamaTools(opts.tools) } : {}),
    options: { num_predict: opts.maxTokens ?? 8192 },
  };

  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  let text = '';
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let doneReason = 'stop';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Ollama streams NDJSON; a chunk can split mid-line, so hold the remainder.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(line) as OllamaChunk;
      } catch {
        continue; // partial or malformed line — skip rather than kill the turn
      }

      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);

      const token = chunk.message?.content;
      if (token) {
        text += token;
        opts.onText?.(token);
      }

      for (const tc of chunk.message?.tool_calls ?? []) {
        const name = tc.function?.name;
        if (!name) continue;
        const rawArgs = tc.function?.arguments;
        // Ollama usually sends an object; some builds send a JSON string.
        let input: Record<string, unknown> = {};
        if (typeof rawArgs === 'string') {
          try { input = JSON.parse(rawArgs) as Record<string, unknown>; } catch { input = {}; }
        } else if (rawArgs && typeof rawArgs === 'object') {
          input = rawArgs as Record<string, unknown>;
        }
        toolCalls.push({ name, input });
      }

      if (chunk.done) doneReason = chunk.done_reason ?? 'stop';
    }
  }

  const content: Anthropic.ContentBlockParam[] = [];
  if (text) content.push({ type: 'text', text });
  for (const tc of toolCalls) {
    content.push({ type: 'tool_use', id: `call_${uuid()}`, name: tc.name, input: tc.input });
  }

  const stop_reason = toolCalls.length
    ? 'tool_use'
    : doneReason === 'length'
      ? 'max_tokens'
      : 'end_turn';

  return { content, stop_reason };
}
