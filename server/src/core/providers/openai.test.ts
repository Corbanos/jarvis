import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const NOW = Math.floor(Date.now() / 1000);

// A signed-in Jarvis store, so resolveRequestAuth picks the ChatGPT path.
const home = mkdtempSync(join(tmpdir(), 'jarvis-openai-provider-'));
process.env['HOME'] = home;
delete process.env['OPENAI_API_KEY'];
mkdirSync(join(home, '.jarvis'), { recursive: true });
writeFileSync(join(home, '.jarvis', 'openai-auth.json'), JSON.stringify({
  tokens: { idToken: jwt({ email: 'a@b.c' }), accessToken: jwt({ exp: NOW + 3600 }), refreshToken: 'rt', accountId: 'acct_X', lastRefresh: '' },
}));

const sse = (events: unknown[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const stream = (text: string, status = 200) => new Response(text, { status, headers: { 'content-type': 'text/event-stream' } });

const TOOL_TURN = sse([
  { type: 'response.created', response: { id: 'resp_1' } },
  { type: 'response.output_text.delta', delta: 'Checking' },
  { type: 'response.output_text.delta', delta: ', sir.' },
  { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENC', summary: [] } },
  { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"location":"Tokyo"}' } },
  { type: 'response.completed', response: { status: 'completed' } },
]);

test('Anthropic history converts to Responses input items', async () => {
  const { toResponsesInput, toResponsesTools } = await import('./openai.js');
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'weather in tokyo' },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call_1', name: 'weather', input: { location: 'Tokyo' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '18C' }] },
  ];
  const echo = (ids: string[]) => ids.map((id) => ({ type: 'reasoning', id: `rs-for-${id}` }));
  const input = toResponsesInput(messages, echo);

  assert.deepEqual(input, [
    { role: 'user', content: [{ type: 'input_text', text: 'weather in tokyo' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }] },
    { type: 'reasoning', id: 'rs-for-call_1' },
    { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"location":"Tokyo"}' },
    { type: 'function_call_output', call_id: 'call_1', output: '18C' },
  ]);

  assert.deepEqual(toResponsesTools([{ name: 'weather', description: 'w', input_schema: { type: 'object', properties: {} } }] as Anthropic.Tool[]), [
    { type: 'function', name: 'weather', description: 'w', parameters: { type: 'object', properties: {} }, strict: false },
  ]);
});

test('the SSE stream yields text deltas, tool calls, reasoning, and status', async () => {
  const { parseResponsesSSE } = await import('./openai.js');
  const tokens: string[] = [];
  const r = await parseResponsesSSE(stream(TOOL_TURN).body!, (t) => tokens.push(t));
  assert.deepEqual(tokens, ['Checking', ', sir.']);
  assert.equal(r.text, 'Checking, sir.');
  assert.deepEqual(r.toolCalls, [{ callId: 'call_1', name: 'weather', input: { location: 'Tokyo' } }]);
  assert.equal(r.reasoning.length, 1);
  assert.equal(r.status, 'completed');

  const cut = await parseResponsesSSE(stream(sse([
    { type: 'response.output_text.delta', delta: 'const x =' },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
  ])).body!);
  assert.equal(cut.status, 'incomplete');
  assert.equal(cut.incompleteReason, 'max_output_tokens');
});

test('a full turn hits the Codex backend with the right shape and echoes reasoning next time', async () => {
  const { streamOpenAI, _resetReasoningCache } = await import('./openai.js');
  _resetReasoningCache();

  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return requests.length === 1
      ? stream(TOOL_TURN)
      : stream(sse([{ type: 'response.output_text.delta', delta: '18C and clear.' }, { type: 'response.completed', response: {} }]));
  }) as typeof fetch;

  const tools = [{ name: 'weather', description: 'w', input_schema: { type: 'object', properties: {} } }] as Anthropic.Tool[];
  const first = await streamOpenAI({ model: 'gpt-6-astra', system: 'You are JARVIS.', messages: [{ role: 'user', content: 'weather?' }], tools, maxTokens: 4000, fetch: fakeFetch });

  assert.equal(requests[0]!.url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(requests[0]!.headers['chatgpt-account-id'], 'acct_X');
  assert.equal(requests[0]!.headers['Accept'], 'text/event-stream');
  const body = requests[0]!.body;
  assert.equal(body['model'], 'gpt-6-astra');
  assert.equal(body['instructions'], 'You are JARVIS.');
  assert.equal(body['store'], false);
  assert.equal(body['stream'], true);
  assert.deepEqual(body['include'], ['reasoning.encrypted_content'], 'reasoning model → ask for encrypted reasoning');
  assert.equal((body['tools'] as unknown[]).length, 1);
  // Observed live: the Codex backend rejects max_output_tokens and applies its own reasoning defaults.
  assert.equal('max_output_tokens' in body, false);
  assert.equal('reasoning' in body, false);

  assert.equal(first.stop_reason, 'tool_use');
  assert.deepEqual(first.content[0], { type: 'text', text: 'Checking, sir.' });
  assert.deepEqual(first.content[1], { type: 'tool_use', id: 'call_1', name: 'weather', input: { location: 'Tokyo' } });

  // Second turn: history + tool result. The cached reasoning item must precede the function_call.
  const second = await streamOpenAI({
    model: 'gpt-6-astra', system: 'You are JARVIS.', tools, fetch: fakeFetch,
    messages: [
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '18C' }] },
    ],
  });
  const input = requests[1]!.body['input'] as Array<Record<string, unknown>>;
  const types = input.map((i) => i['type'] ?? i['role']);
  assert.deepEqual(types, ['user', 'assistant', 'reasoning', 'function_call', 'function_call_output']);
  assert.equal(input[2]!['encrypted_content'], 'ENC');
  assert.equal(second.stop_reason, 'end_turn');
  assert.deepEqual(second.content, [{ type: 'text', text: '18C and clear.' }]);
});

test('the platform API gets the fuller body the Codex backend refuses', async () => {
  const { buildResponsesBody } = await import('./openai.js');
  const opts = { model: 'gpt-6-astra', system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [], maxTokens: 4000 };
  const platform = buildResponsesBody(opts, 'apikey');
  assert.equal(platform['max_output_tokens'], 4000);
  assert.deepEqual(platform['reasoning'], { effort: 'medium', summary: 'auto' });
  const codex = buildResponsesBody(opts, 'chatgpt');
  assert.equal('max_output_tokens' in codex, false);
  assert.equal('reasoning' in codex, false);
  assert.deepEqual(codex['include'], ['reasoning.encrypted_content']);
});

test('the Codex model list drops hidden models and keeps the backend priority order', async () => {
  const { pickCodexModels } = await import('./openai.js');
  assert.deepEqual(pickCodexModels([
    { slug: 'gpt-5.4-mini', visibility: 'list', priority: 23 },
    { slug: 'codex-auto-review', visibility: 'hide', priority: 43 },
    { slug: 'gpt-6-astra', visibility: 'list', priority: 1 },
    { slug: 'gpt-reserve', visibility: 'hide', priority: 3 },
    { slug: 'gpt-5.5', visibility: 'list', priority: 12 },
  ]), ['gpt-6-astra', 'gpt-5.5', 'gpt-5.4-mini']);
});

test('non-reasoning models get no reasoning parameters', async () => {
  const { streamOpenAI } = await import('./openai.js');
  let body: Record<string, unknown> = {};
  const fakeFetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return stream(sse([{ type: 'response.output_text.delta', delta: 'hi' }, { type: 'response.completed', response: {} }]));
  }) as typeof fetch;
  await streamOpenAI({ model: 'gpt-4.1', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], fetch: fakeFetch });
  assert.equal('reasoning' in body, false);
  assert.equal('include' in body, false);
  assert.equal('tools' in body, false, 'no tools → no tool params');
});

test('a 401 on a ChatGPT token refreshes once and retries', async () => {
  const { streamOpenAI } = await import('./openai.js');
  const urls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url); urls.push(u);
    if (u.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: jwt({ exp: NOW + 7200 }), refresh_token: 'rt2', id_token: jwt({}) }), { status: 200 });
    if (urls.filter((x) => x.endsWith('/responses')).length === 1) return new Response('{"detail":"expired"}', { status: 401 });
    return stream(sse([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response: {} }]));
  }) as typeof fetch;
  const r = await streamOpenAI({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], fetch: fakeFetch });
  assert.deepEqual(urls.map((u) => u.split('/').slice(-1)[0]), ['responses', 'token', 'responses']);
  assert.deepEqual(r.content, [{ type: 'text', text: 'ok' }]);
});

test('a length cut-off maps to max_tokens so the agent loop asks for more', async () => {
  const { streamOpenAI } = await import('./openai.js');
  const fakeFetch = (async () => stream(sse([
    { type: 'response.output_text.delta', delta: 'partial' },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
  ]))) as typeof fetch;
  const r = await streamOpenAI({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], fetch: fakeFetch });
  assert.equal(r.stop_reason, 'max_tokens');
});

test('HTTP errors are explained rather than dumped', async () => {
  const { streamOpenAI } = await import('./openai.js');
  const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: 'usage cap reached' } }), { status: 429 })) as typeof fetch;
  await assert.rejects(
    streamOpenAI({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], fetch: fakeFetch }),
    /429.*usage cap reached/,
  );
});

test('an explicit thinking level reaches both backends, clamped to what the Codex model supports', async () => {
  const { buildResponsesBody, clampOpenAIEffort, pickCodexModels } = await import('./openai.js');
  // Learn levels the way the model list teaches them.
  pickCodexModels([{ slug: 'gpt-5.4-mini', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }] }]);

  assert.equal(clampOpenAIEffort('gpt-5.4-mini', 'max'), 'xhigh', 'max steps down to the highest supported');
  assert.equal(clampOpenAIEffort('gpt-5.4-mini', 'high'), 'high');
  assert.equal(clampOpenAIEffort('unknown-model', 'max'), 'max', 'unknown model → sent as-is');
  assert.equal(clampOpenAIEffort('gpt-5.4-mini', 'default'), null);

  const base = { model: 'gpt-5.4-mini', system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [] };
  assert.deepEqual(buildResponsesBody({ ...base, effort: 'max' }, 'chatgpt')['reasoning'], { effort: 'xhigh' });
  assert.deepEqual(buildResponsesBody({ ...base, effort: 'high' }, 'apikey')['reasoning'], { effort: 'high', summary: 'auto' });
  assert.equal('reasoning' in buildResponsesBody({ ...base, effort: 'default' }, 'chatgpt'), false, 'default → Codex backend decides');
  assert.equal('reasoning' in buildResponsesBody({ ...base, model: 'gpt-4.1', effort: 'max' }, 'chatgpt'), false, 'non-reasoning model never gets it');
});
