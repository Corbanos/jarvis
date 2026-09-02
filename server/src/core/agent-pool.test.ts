import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// agent-pool pulls in the SQLite store, which opens ~/.jarvis/jarvis.db at
// import time. Point HOME at a scratch dir first so no test here touches the
// operator's real database or config.
process.env['HOME'] = mkdtempSync(join(tmpdir(), 'jarvis-agent-pool-'));

interface Turn {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
  stop: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
}

/** A model that plays back a fixed script of turns and records what it was sent. */
function scriptedModel(turns: Turn[]) {
  const seen: Array<Array<{ role: string; content: unknown }>> = [];
  const streamChat = async (opts: { messages: Array<{ role: string; content: unknown }>; onText?: (t: string) => void }) => {
    seen.push(opts.messages.map((m) => ({ ...m })));
    const turn = turns.shift();
    if (!turn) throw new Error('scripted model ran out of turns');
    if (turn.text) opts.onText?.(turn.text);
    const content: unknown[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    (turn.tools ?? []).forEach((t, i) => {
      content.push({ type: 'tool_use', id: `call_${seen.length}_${i}`, name: t.name, input: t.input });
    });
    return { content, stop_reason: turn.stop };
  };
  return { streamChat, seen };
}

let toolCalls = 0;
let registered = false;

async function runAgent(turns: Turn[]) {
  const { createAgentPool } = await import('./agent-pool.js');
  const { toolRegistry } = await import('./tool-registry.js');
  if (!registered) {
    toolRegistry.register({
      name: 'read_file',
      description: 'test tool',
      input_schema: { type: 'object', properties: {} },
      handler: async () => { toolCalls++; return 'file contents'; },
    });
    registered = true;
  }

  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let finish!: (v: unknown) => void;
  const finished = new Promise((r) => { finish = r; });
  const ws = {
    broadcast(ev: { type: string; payload: Record<string, unknown> }) {
      events.push(ev);
      if (ev.type === 'agent_complete') finish(ev);
    },
    clientCount: () => 0,
  };

  const model = scriptedModel(turns);
  const pool = createAgentPool(ws as never, { streamChat: model.streamChat as never });
  const record = pool.spawn('do the thing', { role: 'debug' });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('agent never completed')), 5000));
  await Promise.race([finished, timeout]);

  const agent = pool.list().find((a) => a.id === record.id)!;
  return { agent, events, seen: model.seen, logs: pool.getLogs(record.id) };
}

const userText = (m: { role: string; content: unknown }) =>
  m.role === 'user' && typeof m.content === 'string' ? m.content : '';

test('a plan-only first turn is nudged, not treated as completion', async () => {
  const before = toolCalls;
  const { agent, seen, logs } = await runAgent([
    { text: "Here's my plan: first I'll read the file, then patch the bug.", stop: 'end_turn' },
    { text: 'Reading it now.', tools: [{ name: 'read_file', input: { path: 'x' } }], stop: 'tool_use' },
    { text: 'TASK COMPLETE: patched and verified.', stop: 'end_turn' },
  ]);

  assert.equal(agent.status, 'complete');
  assert.equal(seen.length, 3, 'model consulted three times');
  assert.equal(toolCalls - before, 1, 'the tool actually ran');

  // Second call carries the assistant's plan AND the nudge, in that order.
  const second = seen[1]!;
  assert.equal(second.at(-2)?.role, 'assistant');
  assert.match(userText(second.at(-1)!), /without calling a tool/);
  assert.ok(logs.some((l) => l.includes('nudging (1/3)')));
});

test('a max_tokens cut-off asks the agent to continue rather than ending it', async () => {
  const { agent, seen } = await runAgent([
    { text: 'const x = 1;\nconst y =', stop: 'max_tokens' },
    { text: ' 2;\nTASK COMPLETE: written.', stop: 'end_turn' },
  ]);

  assert.equal(agent.status, 'complete');
  assert.equal(seen.length, 2);
  assert.match(userText(seen[1]!.at(-1)!), /cut off/);
});

test('repeated idle turns eventually end the run instead of looping forever', async () => {
  const { agent, seen, logs } = await runAgent([
    { text: 'Thinking about it.', stop: 'end_turn' },
    { text: 'Still thinking.', stop: 'end_turn' },
    { text: 'Hmm.', stop: 'end_turn' },
    { text: 'I believe that covers it.', stop: 'end_turn' },
  ]);

  assert.equal(agent.status, 'complete');
  assert.equal(seen.length, 4, 'three nudges, then the fourth idle turn is accepted');
  assert.ok(logs.some((l) => l.includes('taking its last message as the result')));
});

test('the completion sentinel is honoured with markdown emphasis', async () => {
  const { agent, seen } = await runAgent([
    { text: 'All done.\n\n**TASK COMPLETE:** everything passes.', stop: 'end_turn' },
  ]);
  assert.equal(agent.status, 'complete');
  assert.equal(seen.length, 1);
});

test('mentioning the sentinel mid-sentence does not end the run', async () => {
  const { agent, seen } = await runAgent([
    { text: "I'll write TASK COMPLETE: once the tests pass. Running them.", stop: 'end_turn' },
    { text: 'TASK COMPLETE: tests pass.', stop: 'end_turn' },
  ]);
  assert.equal(agent.status, 'complete');
  assert.equal(seen.length, 2, 'the first turn was treated as idle, not as completion');
});

test('a tool call alongside a stray sentinel still runs the tool', async () => {
  const before = toolCalls;
  const { agent, seen } = await runAgent([
    { text: 'TASK COMPLETE: nearly — verifying.', tools: [{ name: 'read_file', input: {} }], stop: 'tool_use' },
    { text: 'TASK COMPLETE: verified.', stop: 'end_turn' },
  ]);
  assert.equal(agent.status, 'complete');
  assert.equal(toolCalls - before, 1);
  assert.equal(seen.length, 2);
});

test('a failure sentinel marks the agent failed', async () => {
  const { agent } = await runAgent([
    { text: 'TASK FAILED: the endpoint does not exist.', stop: 'end_turn' },
  ]);
  assert.equal(agent.status, 'failed');
});

test('a refusal ends the run as failed without nudging', async () => {
  const { agent, seen } = await runAgent([
    { text: '', stop: 'refusal' },
  ]);
  assert.equal(agent.status, 'failed');
  assert.equal(seen.length, 1);
});
