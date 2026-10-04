import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// agent-pool pulls in the SQLite store, which opens ~/.jarvis/jarvis.db at
// import time. Point HOME at a scratch dir first so nothing here touches the
// operator's real database.
process.env['HOME'] = mkdtempSync(join(tmpdir(), 'jarvis-agent-resume-'));

interface Turn {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
  stop?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Thrown instead of answering — used to fake a provider 429. */
  error?: string;
  /** Runs while the model "thinks", i.e. mid-iteration. */
  before?: () => void | Promise<void>;
}

interface WSEventLite { type: string; payload: Record<string, unknown> }

let registered = false;

async function harness() {
  const { createAgentPool } = await import('./agent-pool.js');
  const { toolRegistry } = await import('./tool-registry.js');
  if (!registered) {
    toolRegistry.register({
      name: 'read_file',
      description: 'test tool',
      input_schema: { type: 'object', properties: {} },
      handler: async () => 'file contents',
    });
    registered = true;
  }

  const turns: Turn[] = [];
  const seen: Array<Array<{ role: string; content: unknown }>> = [];
  const events: WSEventLite[] = [];
  const listeners: Array<(ev: WSEventLite) => void> = [];

  const ws = {
    broadcast(ev: WSEventLite) {
      events.push(ev);
      for (const l of [...listeners]) l(ev);
    },
    clientCount: () => 0,
  };

  const streamChat = async (opts: { messages: Array<{ role: string; content: unknown }>; onText?: (t: string) => void }) => {
    // Deep copy: the loop folds interjections into the last user message in
    // place, so a shallow record would be rewritten under us.
    seen.push(JSON.parse(JSON.stringify(opts.messages)));
    const turn = turns.shift();
    if (!turn) throw new Error('scripted model ran out of turns');
    if (turn.before) await turn.before();
    if (turn.error) throw new Error(turn.error);
    if (turn.text) opts.onText?.(turn.text);
    const content: unknown[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    (turn.tools ?? []).forEach((t, i) => {
      content.push({ type: 'tool_use', id: `call_${seen.length}_${i}`, name: t.name, input: t.input });
    });
    return { content, stop_reason: turn.stop ?? 'end_turn' };
  };

  const pool = createAgentPool(ws as never, { streamChat: streamChat as never });

  function waitFor(pred: (ev: WSEventLite) => boolean, ms = 5000): Promise<WSEventLite> {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for event')), ms);
      const l = (ev: WSEventLite) => {
        if (!pred(ev)) return;
        clearTimeout(timer);
        listeners.splice(listeners.indexOf(l), 1);
        resolve(ev);
      };
      listeners.push(l);
    });
  }

  /** Resolves when a run of this agent ends, however it ended. */
  const settled = (id: string) => waitFor((ev) =>
    (ev.type === 'agent_complete' && ev.payload['id'] === id)
    || (ev.type === 'agent_update' && ev.payload['id'] === id
        && (ev.payload['status'] === 'paused' || ev.payload['status'] === 'stopped')));

  const userTexts = (msgs: Array<{ role: string; content: unknown }>) =>
    msgs.filter((m) => m.role === 'user')
      .map((m) => typeof m.content === 'string'
        ? m.content
        : (m.content as Array<Record<string, unknown>>).map((b) => String(b['text'] ?? b['content'] ?? '')).join('\n'))
      .join('\n---\n');

  /**
   * The agent that was most recently added to the pool. `before` hooks run
   * synchronously inside spawn(), i.e. before spawn() has returned an id, so
   * they look the agent up here instead.
   */
  const newestId = () => pool.list().at(-1)!.id;

  return { pool, turns, seen, events, waitFor, settled, userTexts, newestId };
}

test('a running agent picks up an interjection at its next iteration', async () => {
  const h = await harness();
  h.turns.push(
    // Mid-iteration the operator steers it; the queue is drained at the top of
    // the *next* iteration.
    { text: 'Working.', tools: [{ name: 'read_file', input: {} }], stop: 'tool_use', before: () => { h.pool.steer(h.newestId().slice(0, 8), 'skip the tests'); } },
    { text: 'Understood — dropping the tests.\nTASK COMPLETE: done without tests.', stop: 'end_turn' },
  );

  const rec = h.pool.spawn('do the thing');
  const id = rec.id;
  await h.settled(id);

  const agent = h.pool.get(id)!;
  assert.equal(agent.status, 'complete');
  assert.equal(h.seen.length, 2);
  const second = h.userTexts(h.seen[1]!);
  assert.match(second, /OPERATOR INTERJECTION: skip the tests/);
  assert.ok(h.pool.getLogs(id).some((l) => l.includes('INTERJECTION: skip the tests')));
  assert.equal(agent.pendingInstructions?.length ?? 0, 0, 'queue drained, nothing dropped');
});

test('pause stops the loop between iterations and leaves it resumable', async () => {
  const h = await harness();
  h.turns.push(
    { text: 'Step one.', tools: [{ name: 'read_file', input: {} }], stop: 'tool_use', before: () => { h.pool.pause(h.newestId().slice(0, 8)); } },
  );

  const rec = h.pool.spawn('long job');
  const id = rec.id;
  await h.settled(id);

  const agent = h.pool.get(id)!;
  assert.equal(agent.status, 'paused');
  assert.equal(h.seen.length, 1, 'the model was not consulted again after the pause');
  assert.ok(h.pool.getLogs(id).some((l) => l.includes('PAUSED by operator')));
  // A pause is not a completion — chat must not be told the agent finished.
  assert.ok(!h.events.some((e) => e.type === 'agent_complete' && e.payload['id'] === id));

  // The tool call that was already in flight completed before the loop exited.
  assert.ok(h.pool.getLogs(id).some((l) => l.startsWith('[read_file]')));

  // And the transcript went to SQLite so it survives a restart.
  const { memory } = await import('./memory.js');
  const row = memory.getAgent(id)!;
  assert.equal(row['status'], 'paused');
  assert.ok((row['messages'] as unknown[]).length >= 2, 'transcript persisted');
});

test('resume re-enters the same agent with its prior transcript', async () => {
  const h = await harness();
  h.turns.push(
    { text: 'Reading.', tools: [{ name: 'read_file', input: {} }], stop: 'tool_use', before: () => { h.pool.stop(h.newestId().slice(0, 8)); } },
  );

  const rec = h.pool.spawn('build the widget');
  const id = rec.id;
  await h.settled(id);
  assert.equal(h.pool.get(id)!.status, 'stopped');

  const before = h.pool.list().length;
  h.turns.push({ text: 'TASK COMPLETE: finished after resume.', stop: 'end_turn' });
  const res = h.pool.resume(id.slice(0, 8).toUpperCase(), 'operator restarted it');
  assert.equal(res.ok, true);
  assert.equal(res.agent!.id, id, 'same id, not a new agent');
  assert.equal(h.pool.list().length, before, 'no extra agent appeared');

  await h.waitFor((ev) => ev.type === 'agent_complete' && ev.payload['id'] === id);
  const agent = h.pool.get(id)!;
  assert.equal(agent.status, 'complete');
  assert.equal(agent.resumeCount, 1);
  assert.ok((agent.iterations ?? 0) >= 2, 'iteration count carried across the resume');

  // The resumed call carried the original goal, the prior tool result, and the
  // resume banner.
  const resumed = h.seen[1]!;
  assert.equal(resumed[0]!.role, 'user');
  assert.match(h.userTexts(resumed), /build the widget/);
  assert.match(h.userTexts(resumed), /YOU ARE BEING RESUMED/);
  assert.match(h.userTexts(resumed), /operator restarted it/);
  assert.ok(resumed.some((m) => m.role === 'assistant'), 'prior assistant turns rehydrated');
});

test('an agent killed by a provider 429 resumes in place once credentials are fixed', async () => {
  const h = await harness();
  h.turns.push({ error: '429 rate_limit_error: too many requests' });

  const rec = h.pool.spawn('crunch the numbers');
  const id = rec.id;
  await h.settled(id);

  let agent = h.pool.get(id)!;
  assert.equal(agent.status, 'failed');
  assert.match(agent.lastError ?? '', /429/);

  // Operator queues an instruction while it is down, then resumes it.
  const steered = h.pool.steer(id.slice(0, 8), 'use the backup key');
  assert.equal(steered.delivery, 'queued');

  h.turns.push({ text: 'TASK COMPLETE: crunched.', stop: 'end_turn' });
  assert.equal(h.pool.resume(id, 'new credentials installed, rate limit cleared').ok, true);
  await h.waitFor((ev) => ev.type === 'agent_complete' && ev.payload['id'] === id && ev.payload['status'] === 'complete');

  agent = h.pool.get(id)!;
  assert.equal(agent.status, 'complete');
  const resumedMsgs = h.userTexts(h.seen[1]!);
  assert.match(resumedMsgs, /new credentials installed/);
  // The instruction queued while it was dead was delivered on resume.
  assert.match(resumedMsgs, /OPERATOR INTERJECTION: use the backup key/);
});

test('resuming a running agent is refused, and unknown ids report cleanly', async () => {
  const h = await harness();
  h.turns.push(
    { text: 'thinking', tools: [{ name: 'read_file', input: {} }], stop: 'tool_use' },
    { text: 'TASK COMPLETE: ok.', stop: 'end_turn' },
  );
  const rec = h.pool.spawn('something');
  const id = rec.id;
  const busy = h.pool.resume(id);
  assert.equal(busy.ok, false);
  assert.match(busy.error ?? '', /already running/);
  await h.settled(id);

  assert.equal(h.pool.resume('zzzzzzzz').ok, false);
  assert.equal(h.pool.pause('zzzzzzzz').ok, false);
  assert.equal(h.pool.steer('zzzzzzzz', 'hi').ok, false);
});

test('a transcript with a dangling tool_use is repaired before resuming', async () => {
  const { normalizeTranscript, compactTranscript } = await import('./agent-pool.js');
  const repaired = normalizeTranscript([
    { role: 'user', content: 'goal' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'shell', input: {} }] },
  ], 'goal');
  const last = repaired[repaired.length - 1]!;
  assert.equal(last.role, 'user');
  assert.equal((last.content as Array<{ type: string; tool_use_id?: string }>)[0]!.tool_use_id, 'tu_1');

  // An orphan tool_result (its assistant turn was compacted away) is dropped.
  const cleaned = normalizeTranscript([
    { role: 'user', content: 'goal' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'gone', content: 'x' }] },
  ], 'goal');
  assert.equal(cleaned.length, 1);

  // Compaction always keeps the goal as the first user message.
  const big: Array<{ role: 'user' | 'assistant'; content: unknown }> = [{ role: 'user', content: 'goal' }];
  for (let i = 0; i < 200; i++) {
    big.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'shell', input: {} }] });
    big.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(9000) }] });
  }
  const small = compactTranscript(big as never);
  assert.ok(JSON.stringify(small).length < JSON.stringify(big).length);
  assert.equal(small[0]!.role, 'user');
  assert.equal(small[0]!.content, 'goal');
});
