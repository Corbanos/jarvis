import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeBaseUrl, probeOllama, toOllamaMessages, toOllamaTools } from './ollama.js';

test('operator-typed addresses normalise to a usable base URL', () => {
  assert.equal(normalizeBaseUrl('192.168.1.50'), 'http://192.168.1.50:11434');
  assert.equal(normalizeBaseUrl('192.168.1.50:11434'), 'http://192.168.1.50:11434');
  assert.equal(normalizeBaseUrl('  http://box.local:11434/  '), 'http://box.local:11434');
  assert.equal(normalizeBaseUrl('box.local:9999'), 'http://box.local:9999');
  // An explicit https host keeps its scheme and its implicit port.
  assert.equal(normalizeBaseUrl('https://ollama.example.com'), 'https://ollama.example.com');
  assert.equal(normalizeBaseUrl(''), '');
});

test('a tool round-trip flattens into Ollama roles with results attributed', () => {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'what is the weather in Tokyo' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking, sir.' },
        { type: 'tool_use', id: 'toolu_1', name: 'weather', input: { location: 'Tokyo' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '18C, clear' }],
    },
  ];

  const out = toOllamaMessages('You are JARVIS.', messages);

  assert.deepEqual(out[0], { role: 'system', content: 'You are JARVIS.' });
  assert.deepEqual(out[1], { role: 'user', content: 'what is the weather in Tokyo' });

  // The assistant turn keeps its prose and carries the call alongside it.
  assert.equal(out[2]!.role, 'assistant');
  assert.equal(out[2]!.content, 'Checking, sir.');
  assert.deepEqual(out[2]!.tool_calls, [
    { function: { name: 'weather', arguments: { location: 'Tokyo' } } },
  ]);

  // The result becomes its own `tool` message, named after the call it answers —
  // Ollama has no tool_use ids, so the name is what ties the pair together.
  assert.deepEqual(out[3], { role: 'tool', content: '18C, clear', tool_name: 'weather' });
  assert.equal(out.length, 4);
});

test('parallel tool calls each produce their own result message', () => {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'a', name: 'weather', input: { location: 'Tokyo' } },
        { type: 'tool_use', id: 'b', name: 'shell', input: { cmd: 'uptime' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'b', content: 'up 3 days' },
        { type: 'tool_result', tool_use_id: 'a', content: '18C' },
      ],
    },
  ];

  const out = toOllamaMessages('', messages);

  assert.equal(out[0]!.tool_calls?.length, 2);
  assert.deepEqual(out.slice(1), [
    { role: 'tool', content: 'up 3 days', tool_name: 'shell' },
    { role: 'tool', content: '18C', tool_name: 'weather' },
  ]);
});

test('block-form tool results are flattened to text', () => {
  const messages: Anthropic.MessageParam[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'shell', input: {} }] },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'done' }] },
      ],
    },
  ];

  const out = toOllamaMessages('', messages);
  assert.equal(out[1]!.content, 'done');
});

test('an empty system prompt adds no system message', () => {
  const out = toOllamaMessages('', [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(out, [{ role: 'user', content: 'hi' }]);
});

test('tools convert to OpenAI-style function schemas', () => {
  const tools = [
    {
      name: 'weather',
      description: 'Current conditions',
      input_schema: { type: 'object' as const, properties: { location: { type: 'string' } }, required: ['location'] },
    },
  ] as Anthropic.Tool[];

  assert.deepEqual(toOllamaTools(tools), [
    {
      type: 'function',
      function: {
        name: 'weather',
        description: 'Current conditions',
        parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
      },
    },
  ]);
});

test('an unreachable host reports something actionable, not "fetch failed"', async () => {
  // Port 1 is reliably closed. Node buries the real cause inside an
  // AggregateError here, which is exactly the case that used to leak through.
  const probe = await probeOllama('127.0.0.1:1', 2000);
  assert.equal(probe.ok, false);
  assert.equal(probe.baseUrl, 'http://127.0.0.1:1');
  assert.notEqual(probe.error, 'fetch failed');
  assert.match(probe.error ?? '', /refused|unreachable|not found|Could not reach/i);
});

test('a blank address is rejected before any network call', async () => {
  const probe = await probeOllama('   ');
  assert.equal(probe.ok, false);
  assert.match(probe.error ?? '', /Enter a host/i);
});
