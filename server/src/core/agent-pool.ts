import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { memory } from './memory.js';
import { getActiveProjectId } from './active-project.js';
import { toolRegistry } from './tool-registry.js';
import { streamChat, effectiveModel } from './providers/index.js';
import { CODEBASE_MAP } from '../tools/self.js';
import { log } from './logger.js';
import type { AgentControl, AgentRecord } from '../types/index.js';
import type { WSHub } from '../ws.js';

const AGENT_SYSTEM_PROMPT = `You are a J.A.R.V.I.S. sub-agent — an autonomous worker spawned by the main Jarvis to complete a specific goal.

## How this loop works — read this twice
You run inside an automated loop. Each turn you take does exactly one of two things:
  (a) calls one or more tools — the results come back and you get another turn; or
  (b) ends the task by writing, on its own line, either
        TASK COMPLETE: <one-line summary of what was done and how it was verified>
        TASK FAILED: <what blocked you and what you tried>
A turn that does neither is wasted — you will simply be told to continue. So never end a turn on a plan, a status update, or "let me check X" without also calling the tool that checks X. Put the plan in the same turn as your first tool call.

Large goals are expected to take many turns — dozens is normal. Keep going until the goal is verified, not merely attempted: run the test, reload the page, read the file back. Then declare completion.

## Your role
- You have a SINGLE, FOCUSED goal. Pursue it relentlessly.
- You have full tool access: shell, filesystem, browser, web search.
- Work autonomously. Do not ask questions; make reasonable decisions.
- When complete, return a concise SUMMARY of what you did and the result.

## Output format
- Narrate progress briefly as you work (1-2 sentences per major step), in the same turn as the tool calls that do the work.
- Use code blocks for code/file contents.
- End with: "TASK COMPLETE: <one-line summary>" or "TASK FAILED: <reason>" on its own line.

## Operator interjections
A message beginning "OPERATOR INTERJECTION:" is a live instruction from the operator (or the main Jarvis) injected into your loop. It OUTRANKS your current plan: acknowledge it in one line, adjust course immediately, then carry on. A message beginning "OPERATOR NOTE — YOU ARE BEING RESUMED" means this same run was interrupted and has been restarted with your own prior transcript above.

## Working on JARVIS itself
If the goal is about JARVIS's own code (its HUD, server, tools, panels), you have the 'self' tool: call self info first, edit with filesystem, then self build and self test until green. Do NOT call self restart — end with "TASK COMPLETE: <what changed> — restart required (hud|server)" and the main Jarvis restarts so your completion is recorded.
${CODEBASE_MAP}

## Constraints
- Do NOT spawn further sub-agents (avoid runaway recursion).
- Do NOT ask the operator questions — work with what you have.
- If blocked, attempt 2-3 alternatives before failing.
- Stay focused on the goal. Don't drift.

Begin work immediately on the goal you're given.`;

interface InternalAgent extends AgentRecord {
  abortController?: AbortController;
  /** Queue of operator interjections, drained at the top of each iteration. */
  pendingInstructions?: string[];
  /** Live task-loop transcript. Persisted (compacted) so it can be rehydrated. */
  messages?: Anthropic.MessageParam[];
  /** True while a loop is actually attached to this record. */
  active?: boolean;
}

const pool = new Map<string, InternalAgent>();

// Current model for all agents.
// Opus 5 is the recommended default for agentic work: strongest reasoning
// at Opus pricing, thinking on by default.
let currentModel = 'claude-opus-5';

// Available models, newest first within each tier. Current as of 2026-09-02.
// Bare ids only — never date-suffixed; the API resolves each to its latest
// snapshot, and suffixed ids stop working when a snapshot is retired.
export const AVAILABLE_MODELS = [
  'claude-opus-5',      // default
  'claude-fable-5-1',   // most capable; premium pricing, thinking always on
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

export type ClaudeModel = typeof AVAILABLE_MODELS[number];

// Completion sentinels are honoured only at the start of a line (markdown
// emphasis allowed), so an agent *talking about* the phrase mid-sentence
// doesn't end its own run.
const SENTINEL_COMPLETE = /^[\s*_#>-]*TASK COMPLETE:/im;
const SENTINEL_FAILED = /^[\s*_#>-]*TASK FAILED:/im;

// A turn that neither calls a tool nor declares an outcome is a pause, not a
// finish — models routinely open a big task by narrating the plan. Nudge them
// back to work, but not forever: after this many consecutive idle turns the
// last message is taken as the result.
const MAX_IDLE_TURNS = 3;
// Consecutive max_tokens cut-offs tolerated before giving up on a runaway.
const MAX_TRUNCATIONS = 6;
// Agents write whole files; a low ceiling just produces truncation nudges.
const AGENT_MAX_TOKENS = 32_000;

// Transcript persistence limits. A resumable agent is only as good as what was
// written down, but a multi-hour run would otherwise put megabytes into SQLite
// on every iteration.
const MAX_BLOCK_CHARS = 8_000;        // per text / tool_result block
const MAX_TRANSCRIPT_CHARS = 600_000; // serialised transcript budget
const MAX_TOOL_LOG = 300;             // tool-call log entries kept
const MAX_LOG_LINES = 600;            // agent.logs entries persisted

const IDLE_NUDGE = 'You ended your turn without calling a tool and without declaring an outcome. '
  + 'This loop only ends when you write `TASK COMPLETE: <summary>` or `TASK FAILED: <reason>` on its own line. '
  + 'If the goal is genuinely done and verified, write that now. Otherwise keep working — call the tools you need.';
const TRUNCATION_NUDGE = 'Your output was cut off by the length limit. Continue exactly where you left off — do not repeat what you already wrote.';

const ROLE_BRIEFS: Record<string, string> = {
  debug: 'Reproduce the problem first, locate the cause, fix it, then re-run the same reproduction until it passes.',
  builder: 'Implement the feature, then actually run or load it and fix whatever breaks until it works end to end.',
  research: 'Gather from primary sources, verify claims against each other, and finish with a concrete, sourced summary.',
  manager: 'Break the goal into ordered steps, execute them, and report what was done at each step.',
  worker: '',
};

function buildAgentSystemPrompt(role?: string): string {
  const brief = role ? ROLE_BRIEFS[role] : undefined;
  if (!role || !brief) return AGENT_SYSTEM_PROMPT;
  return `${AGENT_SYSTEM_PROMPT}\n\n## Role: ${role}\n${brief}`;
}

/**
 * The assistant turn must be appended before a nudge so roles keep
 * alternating; an entirely empty turn gets a placeholder because the API
 * rejects empty content.
 */
function assistantTurn(content: Anthropic.ContentBlockParam[], text: string): Anthropic.MessageParam {
  if (content.length) return { role: 'assistant', content };
  return { role: 'assistant', content: [{ type: 'text', text: text.trim() || '(no output)' }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcript plumbing — resume + interjection support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append operator text to the transcript without breaking role alternation.
 * The top of an iteration normally sits right after a user tool_result turn,
 * so the text is folded into that turn as a trailing block; a tool_result must
 * lead its message, and extra text blocks after it are legal.
 */
function pushUserText(messages: Anthropic.MessageParam[], text: string): void {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') {
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content }, { type: 'text', text }];
    } else {
      (last.content as Anthropic.ContentBlockParam[]).push({ type: 'text', text });
    }
    return;
  }
  messages.push({ role: 'user', content: [{ type: 'text', text }] });
}

function blocksOf(m: Anthropic.MessageParam): Anthropic.ContentBlockParam[] | null {
  return Array.isArray(m.content) ? m.content as Anthropic.ContentBlockParam[] : null;
}

/**
 * Make a stored transcript safe to send back to a provider:
 *  - it must start with a user message (the goal),
 *  - tool_result blocks must answer tool_use ids in the message before them,
 *  - a trailing assistant turn with unanswered tool_use gets synthetic results
 *    (the run died before those tools returned),
 *  - empty turns are dropped (the API rejects them).
 */
export function normalizeTranscript(
  input: Anthropic.MessageParam[],
  goal: string
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const raw of input) {
    const m: Anthropic.MessageParam = { role: raw.role, content: raw.content };
    const blocks = blocksOf(m);

    if (blocks) {
      const prev = out[out.length - 1];
      const prevIds = new Set(
        (prev && prev.role === 'assistant' ? blocksOf(prev) ?? [] : [])
          .filter((b) => b.type === 'tool_use')
          .map((b) => (b as Anthropic.ToolUseBlockParam).id)
      );
      const kept = blocks.filter((b) => {
        if (b.type !== 'tool_result') return true;
        return prevIds.has((b as Anthropic.ToolResultBlockParam).tool_use_id);
      });
      if (!kept.length) continue;
      m.content = kept;
    } else if (typeof m.content === 'string' && !m.content.trim()) {
      continue;
    }

    out.push(m);
  }

  // Answer any tool_use left dangling by an interrupted run.
  const last = out[out.length - 1];
  if (last && last.role === 'assistant') {
    const dangling = (blocksOf(last) ?? []).filter((b) => b.type === 'tool_use') as Anthropic.ToolUseBlockParam[];
    if (dangling.length) {
      out.push({
        role: 'user',
        content: dangling.map((b) => ({
          type: 'tool_result' as const,
          tool_use_id: b.id,
          content: '[not run — the previous run of this agent was interrupted before this tool returned]',
        })),
      });
    }
  }

  if (!out.length || out[0]!.role !== 'user') {
    out.unshift({ role: 'user', content: goal });
  }
  return out;
}

function truncateBlocks(m: Anthropic.MessageParam): Anthropic.MessageParam {
  const blocks = blocksOf(m);
  if (!blocks) {
    const text = m.content as string;
    return { role: m.role, content: text.length > MAX_BLOCK_CHARS ? `${text.slice(0, MAX_BLOCK_CHARS)}\n…[truncated]` : text };
  }
  const clipped = blocks.map((b) => {
    if (b.type === 'text' && b.text.length > MAX_BLOCK_CHARS) {
      return { ...b, text: `${b.text.slice(0, MAX_BLOCK_CHARS)}\n…[truncated]` };
    }
    if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > MAX_BLOCK_CHARS) {
      return { ...b, content: `${b.content.slice(0, MAX_BLOCK_CHARS)}\n…[truncated]` };
    }
    return b;
  });
  return { role: m.role, content: clipped };
}

/**
 * Shrink a transcript for storage: clip huge blocks, then drop the oldest
 * assistant+user PAIRS (never the goal) so tool_use/tool_result stay matched.
 */
export function compactTranscript(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  let out = messages.map(truncateBlocks);
  while (JSON.stringify(out).length > MAX_TRANSCRIPT_CHARS && out.length > 3) {
    out = [out[0]!, ...out.slice(3)];
    // If dropping a pair left an orphan tool_result at the head, drop that too.
    while (out.length > 1) {
      const head = out[1]!;
      const hasOrphan = (blocksOf(head) ?? []).some((b) => b.type === 'tool_result');
      if (head.role === 'user' && hasOrphan) out = [out[0]!, ...out.slice(2)];
      else break;
    }
  }
  return out;
}

function resumeBanner(agent: InternalAgent, reason: string): string {
  return [
    'OPERATOR NOTE — YOU ARE BEING RESUMED.',
    `You are the same agent (${agent.id.slice(0, 8).toUpperCase()}); everything above is your own prior transcript, not someone else's work.`,
    `The previous run ended because: ${reason}`,
    'That blocking condition has been dealt with. Do not start over: re-check the current state of the work (read the files back, re-run the failing command) and then carry on from where you stopped.',
    'Your iteration, idle and truncation budgets are reset. Finish with `TASK COMPLETE: <summary>` or `TASK FAILED: <reason>` as usual.',
    `Original goal, restated: ${agent.goal}`,
  ].join('\n');
}

/** Strip the internals before handing a record to a route / the HUD. */
function toRecord(a: InternalAgent): AgentRecord {
  const { abortController: _ac, messages: _m, active: _act, ...rest } = a;
  return {
    ...rest,
    logs: [...a.logs],
    pendingInstructions: [...(a.pendingInstructions ?? [])],
  };
}

function persist(agent: InternalAgent): void {
  memory.saveAgent({
    id: agent.id,
    goal: agent.goal,
    status: agent.status,
    startedAt: agent.startedAt,
    completedAt: agent.completedAt,
    logs: agent.logs.slice(-MAX_LOG_LINES),
    pid: agent.pid,
    model: agent.model,
    projectId: agent.projectId,
    parentAgentId: agent.parentAgentId,
    role: agent.role,
    summary: agent.summary,
    messages: compactTranscript(agent.messages ?? []),
    toolCalls: (agent.toolCalls ?? []).slice(-MAX_TOOL_LOG),
    iterations: agent.iterations,
    lastError: agent.lastError,
    pendingInstructions: agent.pendingInstructions ?? [],
    resumeCount: agent.resumeCount,
  });
}

export interface AgentPoolDeps {
  /** Overridable so the loop can be driven by a scripted model in tests. */
  streamChat?: typeof streamChat;
}

export interface AgentActionResult {
  ok: boolean;
  error?: string;
  agent?: AgentRecord;
}

export function createAgentPool(ws: WSHub, deps: AgentPoolDeps = {}) {
  const stream = deps.streamChat ?? streamChat;

  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

  /** Push the whole current state of an agent to the HUD. */
  function announce(agent: InternalAgent, extra: Record<string, unknown> = {}) {
    broadcast('agent_update', {
      id: agent.id,
      status: agent.status,
      model: agent.model,
      iterations: agent.iterations ?? 0,
      resumeCount: agent.resumeCount ?? 0,
      pendingControl: agent.pendingControl ?? null,
      pendingInstructions: [...(agent.pendingInstructions ?? [])],
      completedAt: agent.completedAt ?? null,
      lastError: agent.lastError ?? null,
      ...extra,
    });
  }

  // Load all persisted agents from DB on startup
  function loadPersistedAgents() {
    const dbAgents = memory.getAgents();
    for (const row of dbAgents) {
      if (!pool.has(row['id'] as string)) {
        // A run that was in flight when the process last stopped (a `self
        // restart`, a crash) has no loop to return to — record that rather
        // than show it as running forever. It stays resumable: the transcript
        // and pending interjections came back with the row.
        const persisted = row['status'] as AgentRecord['status'];
        const interrupted = persisted === 'running' || persisted === 'spawning';
        const logs = row['logs'] as string[];
        if (interrupted) logs.push('[loop] server restarted while this agent was running — resume to continue');
        const agent: InternalAgent = {
          id: row['id'] as string,
          goal: row['goal'] as string,
          status: interrupted ? 'failed' : persisted,
          startedAt: row['started_at'] as number,
          completedAt: row['completed_at'] as number | undefined,
          logs,
          model: row['model'] as string | undefined,
          projectId: (row['project_id'] as string | undefined) ?? undefined,
          parentAgentId: (row['parent_agent_id'] as string | undefined) ?? undefined,
          role: (row['role'] as string | undefined) ?? undefined,
          summary: (row['summary'] as string | undefined) ?? undefined,
          iterations: (row['iterations'] as number | undefined) ?? 0,
          lastError: (row['last_error'] as string | undefined) ?? undefined,
          resumeCount: (row['resume_count'] as number | undefined) ?? 0,
          messages: (row['messages'] as Anthropic.MessageParam[] | undefined) ?? [],
          pendingInstructions: (row['pending_instructions'] as string[] | undefined) ?? [],
          toolCalls: (row['tool_calls'] as AgentRecord['toolCalls']) ?? [],
        };
        if (interrupted) {
          agent.completedAt = agent.completedAt ?? Date.now();
          agent.lastError = agent.lastError ?? 'the server restarted mid-run';
          persist(agent);
        }
        pool.set(agent.id, agent);
      }
    }
  }

  // Load on init
  loadPersistedAgents();

  /**
   * Run (or re-enter) the agent's main loop. Fire-and-forget: callers don't
   * await it. `resumeReason` set means the transcript on the record is
   * rehydrated as context instead of starting from the bare goal.
   */
  async function runAgent(agent: InternalAgent, resumeReason?: string): Promise<void> {
    const abort = new AbortController();
    agent.abortController = abort;
    agent.active = true;
    agent.status = 'running';
    agent.completedAt = undefined;
    agent.pendingControl = undefined;
    if (!agent.pendingInstructions) agent.pendingInstructions = [];
    if (!agent.toolCalls) agent.toolCalls = [];

    const agentModel = agent.model ?? currentModel;
    const resuming = !!resumeReason;

    const messages: Anthropic.MessageParam[] = resuming && agent.messages?.length
      ? normalizeTranscript(agent.messages, agent.goal)
      : [{ role: 'user', content: agent.goal }];
    agent.messages = messages;

    if (resuming) {
      pushUserText(messages, resumeBanner(agent, resumeReason!));
      agent.logs.push(`[loop] RESUMED (#${agent.resumeCount ?? 1}) after: ${resumeReason}`);
    }

    log.agent(resuming ? 'resume' : 'start', agent.id, agent.goal.slice(0, 80));
    announce(agent, { resumed: resuming, model: agentModel });
    persist(agent);

    const system = buildAgentSystemPrompt(agent.role);
    // Per-run budgets. A resume starts every counter fresh — that is the
    // "iteration budget reset" a resumed agent is entitled to.
    let idleTurns = 0;
    let truncations = 0;
    // No iteration cap — agents run until they finish, fail, are stopped, or context is exhausted.

    try {
      while (true) {
        agent.iterations = (agent.iterations ?? 0) + 1;

        if (abort.signal.aborted) {
          agent.status = 'failed';
          agent.lastError = 'aborted by operator';
          agent.logs.push('[ABORTED by operator]');
          break;
        }

        // ── Cooperative control, checked at the iteration boundary so we
        // never tear down mid tool-call. Both states stay resumable.
        if (agent.pendingControl === 'stop') {
          agent.status = 'stopped';
          agent.lastError = 'stopped by operator';
          agent.logs.push('[loop] STOPPED by operator at a safe point');
          break;
        }
        if (agent.pendingControl === 'pause') {
          agent.status = 'paused';
          agent.lastError = 'paused by operator';
          agent.logs.push('[loop] PAUSED by operator at a safe point — resume to continue');
          break;
        }

        // ── Drain the interjection queue. High-priority user-role turns, in
        // the order they were sent; nothing is silently dropped.
        while (agent.pendingInstructions && agent.pendingInstructions.length) {
          const instruction = agent.pendingInstructions.shift()!;
          log.agent('interjection', agent.id, instruction.slice(0, 60));
          pushUserText(messages, `OPERATOR INTERJECTION: ${instruction}\n(This outranks your current plan. Acknowledge in one line, adjust, continue.)`);
          agent.logs.push(`>> INTERJECTION: ${instruction}`);
          broadcast('agent_instruction', { id: agent.id, instruction });
        }

        let iterText = '';
        const final = await stream({
          model: agentModel,
          maxTokens: AGENT_MAX_TOKENS,
          system,
          tools: toolRegistry.anthropicTools().filter((t) => t.name !== 'spawn_agent' && t.name !== 'agent_control') as Anthropic.Tool[],
          messages,
          signal: abort.signal,
          onText: (token: string) => {
            iterText += token;
            // Stream tokens to HUD agent panel
            broadcast('agent_token', { id: agent.id, token });
          },
        });

        if (iterText.trim()) {
          agent.logs.push(iterText.trim());
        }

        // Tool calls take priority over anything said alongside them: a model
        // that writes "TASK COMPLETE" while still requesting a tool is not done.
        const toolUses = final.stop_reason === 'tool_use'
          ? final.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
          : [];

        if (!toolUses.length) {
          if (SENTINEL_COMPLETE.test(iterText)) {
            agent.status = 'complete';
            messages.push(assistantTurn(final.content, iterText));
            break;
          }
          if (SENTINEL_FAILED.test(iterText)) {
            agent.status = 'failed';
            agent.lastError = iterText.trim().slice(0, 300);
            messages.push(assistantTurn(final.content, iterText));
            break;
          }

          if (final.stop_reason === 'refusal') {
            agent.status = 'failed';
            agent.lastError = 'the model declined this request';
            agent.logs.push('[loop] the model declined this request');
            break;
          }

          if (final.stop_reason === 'max_tokens') {
            truncations++;
            if (truncations > MAX_TRUNCATIONS) {
              agent.status = 'failed';
              agent.lastError = `output cut off ${truncations} times in a row`;
              agent.logs.push(`[loop] output cut off ${truncations} times in a row — stopping`);
              break;
            }
            agent.logs.push('[loop] output cut off by the length limit — asking the agent to continue');
            broadcast('agent_nudge', { id: agent.id, reason: 'truncated', count: truncations });
            messages.push(assistantTurn(final.content, iterText));
            messages.push({ role: 'user', content: TRUNCATION_NUDGE });
            persist(agent);
            continue;
          }

          // Plain end_turn with no outcome declared: the model paused to
          // narrate. This used to be read as "done", which is why agents were
          // finishing after a single message.
          idleTurns++;
          if (idleTurns > MAX_IDLE_TURNS) {
            agent.status = 'complete';
            agent.logs.push(`[loop] agent stopped without declaring an outcome ${idleTurns} times — taking its last message as the result`);
            messages.push(assistantTurn(final.content, iterText));
            break;
          }
          agent.logs.push(`[loop] agent paused without a tool call or outcome — nudging (${idleTurns}/${MAX_IDLE_TURNS})`);
          broadcast('agent_nudge', { id: agent.id, reason: 'idle', count: idleTurns });
          messages.push(assistantTurn(final.content, iterText));
          messages.push({ role: 'user', content: IDLE_NUDGE });
          persist(agent);
          continue;
        }

        // Real work happened this turn; the pause/truncation counters reset.
        idleTurns = 0;
        truncations = 0;

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          // Check for abort before each tool
          if (abort.signal.aborted) {
            agent.status = 'failed';
            agent.lastError = 'aborted by operator';
            break;
          }

          log.agent('tool', agent.id, `${tu.name}`);
          broadcast('agent_tool', { id: agent.id, tool: tu.name, input: tu.input });

          const result = await toolRegistry.dispatch(tu.name, tu.input as Record<string, unknown>);
          const resultPreview = result.slice(0, 200).replace(/\n/g, ' ');
          agent.logs.push(`[${tu.name}] → ${resultPreview}`);
          agent.toolCalls!.push({ tool: tu.name, at: Date.now(), preview: resultPreview });
          if (agent.toolCalls!.length > MAX_TOOL_LOG) agent.toolCalls!.splice(0, agent.toolCalls!.length - MAX_TOOL_LOG);
          broadcast('agent_tool_result', { id: agent.id, tool: tu.name, result: resultPreview });

          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
        }

        if (abort.signal.aborted) break;

        messages.push({ role: 'assistant', content: final.content });
        messages.push({ role: 'user', content: toolResults });
        persist(agent);
      }

    } catch (err) {
      log.error('Agent', `${agent.id}: ${err}`);
      agent.status = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      agent.lastError = msg.slice(0, 500);
      agent.logs.push(`Error: ${msg}`);
    }

    agent.completedAt = Date.now();
    agent.active = false;
    agent.abortController = undefined;
    agent.pendingControl = undefined;
    if (agent.status === 'complete') agent.lastError = undefined;
    persist(agent);

    log.agent(agent.status === 'complete' ? 'complete' : agent.status, agent.id);

    const summary = (agent.logs[agent.logs.length - 1] ?? '').slice(0, 300);

    // A paused/stopped agent hasn't finished — it must not be reported to chat
    // as a completion. The HUD just re-renders it as resumable.
    if (agent.status === 'paused' || agent.status === 'stopped') {
      announce(agent, { resumable: true, summary });
      return;
    }

    // Final summary line for chat
    broadcast('agent_complete', {
      id: agent.id,
      goal: agent.goal,
      status: agent.status,
      summary,
      duration: agent.completedAt - agent.startedAt,
      model: agentModel,
      resumable: agent.status === 'failed',
    });
  }

  /** Resolve an id, a short prefix ("AECF653A"), or an "A-XXXXXX" HUD label. */
  function matchIds(query: string): string[] {
    const needle = query.trim().toLowerCase().replace(/^a-/, '').replace(/[^0-9a-f-]/g, '');
    if (!needle) return [];
    if (pool.has(needle)) return [needle];
    const ids = Array.from(pool.keys());
    const exact = ids.find((k) => k.toLowerCase() === needle);
    if (exact) return [exact];
    return ids.filter((k) => k.toLowerCase().replace(/-/g, '').startsWith(needle.replace(/-/g, '')));
  }

  function resolveId(query: string): string | undefined {
    const hits = matchIds(query);
    return hits.length === 1 ? hits[0] : undefined;
  }

  /** Shared implementation for pause/stop — cooperative, checked between iterations. */
  function control(query: string, mode: AgentControl): AgentActionResult {
    const id = resolveId(query);
    if (!id) return { ok: false, error: `no agent matches "${query}"` };
    const agent = pool.get(id)!;
    if (agent.status !== 'running') {
      return { ok: false, error: `agent ${id.slice(0, 8)} is ${agent.status}, not running`, agent: toRecord(agent) };
    }
    agent.pendingControl = mode;
    agent.logs.push(`[loop] ${mode.toUpperCase()} requested — will take effect at the next safe point`);
    persist(agent);
    announce(agent, { control: mode });
    return { ok: true, agent: toRecord(agent) };
  }

  return {
    spawn(goal: string, opts?: { projectId?: string; parentAgentId?: string; role?: string }): AgentRecord {
      const id = uuid();
      // Auto-link to active project if caller didn't specify.
      const projectId = opts?.projectId ?? getActiveProjectId() ?? undefined;
      const agent: InternalAgent = {
        id,
        goal,
        status: 'running',
        startedAt: Date.now(),
        logs: [],
        model: currentModel,
        projectId,
        parentAgentId: opts?.parentAgentId,
        role: opts?.role,
        iterations: 0,
        resumeCount: 0,
        pendingInstructions: [],
        toolCalls: [],
        messages: [],
      };

      pool.set(id, agent);
      persist(agent);
      broadcast('agent_spawn', { id, goal, status: 'running', model: currentModel, projectId, parentAgentId: opts?.parentAgentId, role: opts?.role });

      // Fire-and-forget: don't await
      runAgent(agent).catch((err) => log.error('Agent', String(err)));

      return toRecord(agent);
    },

    /** Exact id for a possibly-abbreviated query, or undefined if 0 / >1 match. */
    resolve(query: string): string | undefined {
      return resolveId(query);
    },

    matchIds,

    kill(id: string): boolean {
      const agent = pool.get(id);
      if (!agent || agent.status !== 'running') return false;
      agent.abortController?.abort();
      agent.status = 'failed';
      agent.completedAt = Date.now();
      agent.lastError = 'killed by operator';
      agent.logs.push('[KILLED by operator]');
      persist(agent);
      broadcast('agent_complete', { id, status: 'failed', reason: 'killed by user', resumable: true });
      return true;
    },

    /**
     * Re-enter a stopped / paused / failed / completed agent's loop IN PLACE:
     * same id, same record, prior transcript rehydrated plus a note explaining
     * why it is resuming. This is the recovery path for "died on a provider
     * 429 and the operator now has working credentials".
     */
    resume(query: string, note?: string): AgentActionResult {
      const id = this.resolve(query);
      if (!id) return { ok: false, error: `no agent matches "${query}"` };
      const agent = pool.get(id)!;
      if (agent.active || agent.status === 'running') {
        return { ok: false, error: `agent ${id.slice(0, 8)} is already running`, agent: toRecord(agent) };
      }

      // Nothing in memory? Pull the persisted transcript back (post-restart).
      if (!agent.messages?.length) {
        const row = memory.getAgent(id);
        if (row) {
          agent.messages = (row['messages'] as Anthropic.MessageParam[] | undefined) ?? [];
          if (!agent.pendingInstructions?.length) {
            agent.pendingInstructions = (row['pending_instructions'] as string[] | undefined) ?? [];
          }
        }
      }

      const reason = note?.trim()
        || agent.lastError
        || (agent.status === 'complete' ? 'the operator wants more work on this' : 'the previous run ended without an explanation');

      agent.resumeCount = (agent.resumeCount ?? 0) + 1;
      agent.summary = undefined;
      broadcast('agent_resume', { id, reason, resumeCount: agent.resumeCount });

      runAgent(agent, reason).catch((err) => log.error('Agent', String(err)));
      return { ok: true, agent: toRecord(agent) };
    },

    /**
     * Inject an operator / main-Jarvis instruction into an agent. A running
     * agent picks it up at its next loop iteration; a paused, stopped or
     * failed agent keeps it queued and receives it on resume.
     */
    steer(query: string, message: string): AgentActionResult & { delivery?: 'live' | 'queued' } {
      const id = this.resolve(query);
      if (!id) return { ok: false, error: `no agent matches "${query}"` };
      const agent = pool.get(id)!;
      const text = message.trim();
      if (!text) return { ok: false, error: 'message is empty' };

      if (!agent.pendingInstructions) agent.pendingInstructions = [];
      agent.pendingInstructions.push(text);
      const delivery = agent.status === 'running' ? 'live' as const : 'queued' as const;
      if (delivery === 'queued') {
        agent.logs.push(`>> INTERJECTION QUEUED (delivered on resume): ${text}`);
      }
      persist(agent);
      broadcast('agent_instruction_queued', { id, instruction: text, delivery, status: agent.status });
      announce(agent);
      return { ok: true, agent: toRecord(agent), delivery };
    },

    /** Back-compat alias for the original /instruct endpoint. */
    sendInstruction(id: string, instruction: string): boolean {
      return this.steer(id, instruction).ok;
    },

    /**
     * Cooperative pause: the flag is read at the next iteration boundary, so
     * an in-flight tool call finishes first. Resumable afterwards.
     */
    pause(query: string): AgentActionResult {
      return control(query, 'pause');
    },

    /** Cooperative stop — same safe-point semantics as pause. */
    stop(query: string): AgentActionResult {
      return control(query, 'stop');
    },

    /**
     * List all agents (both running and historical)
     */
    list(): AgentRecord[] {
      return Array.from(pool.values()).map(toRecord);
    },

    /**
     * List only running agents
     */
    listRunning(): AgentRecord[] {
      return this.list().filter((a) => a.status === 'running');
    },

    /**
     * List only completed agents (historical)
     */
    listHistory(): AgentRecord[] {
      return this.list().filter((a) => a.status !== 'running');
    },

    get(id: string): AgentRecord | undefined {
      const resolved = this.resolve(id) ?? id;
      const a = pool.get(resolved);
      return a ? toRecord(a) : undefined;
    },

    /**
     * Get full logs for an agent
     */
    getLogs(id: string): string[] {
      const resolved = this.resolve(id) ?? id;
      return pool.get(resolved)?.logs ?? [];
    },

    /** The rehydratable transcript, for diagnostics / the steer test. */
    getTranscript(id: string): Anthropic.MessageParam[] {
      const resolved = this.resolve(id) ?? id;
      return pool.get(resolved)?.messages ?? [];
    },

    /**
     * Set the model for all future agents
     */
    setModel(model: string): boolean {
      if (!AVAILABLE_MODELS.includes(model as ClaudeModel)) return false;
      currentModel = model;
      broadcast('model_changed', { model });
      return true;
    },

    /**
     * Get current model
     */
    getModel(): string {
      return currentModel;
    },

    /**
     * Get available models
     */
    getAvailableModels(): string[] {
      return [...AVAILABLE_MODELS];
    },

    /**
     * Clear historical (non-running) agents
     */
    clearHistory(): number {
      const toRemove: string[] = [];
      for (const [id, agent] of pool) {
        // Paused agents are unfinished work waiting on a resume — clearing the
        // history must not throw them away.
        if (agent.status !== 'running' && agent.status !== 'spawning' && agent.status !== 'paused') {
          toRemove.push(id);
        }
      }
      for (const id of toRemove) {
        pool.delete(id);
        memory.deleteAgent(id);
      }
      broadcast('agents_history_cleared', { count: toRemove.length });
      return toRemove.length;
    },

    /**
     * Reload agents from database (useful after restart)
     */
    reloadFromDB(): void {
      loadPersistedAgents();
    },
  };

}

export type AgentPool = ReturnType<typeof createAgentPool>;

// Re-exported so callers can name the effective model in logs without a second
// import of the provider layer.
export { effectiveModel };
