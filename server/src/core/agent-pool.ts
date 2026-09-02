import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { memory } from './memory.js';
import { getActiveProjectId } from './active-project.js';
import { toolRegistry } from './tool-registry.js';
import { streamChat, effectiveModel } from './providers/index.js';
import { log } from './logger.js';
import type { AgentRecord } from '../types/index.js';
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

## Constraints
- Do NOT spawn further sub-agents (avoid runaway recursion).
- Do NOT ask the operator questions — work with what you have.
- If blocked, attempt 2-3 alternatives before failing.
- Stay focused on the goal. Don't drift.

Begin work immediately on the goal you're given.`;

interface InternalAgent extends AgentRecord {
  abortController?: AbortController;
  pendingInstructions?: string[];  // Live instructions queue
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

export interface AgentPoolDeps {
  /** Overridable so the loop can be driven by a scripted model in tests. */
  streamChat?: typeof streamChat;
}

export function createAgentPool(ws: WSHub, deps: AgentPoolDeps = {}) {
  const stream = deps.streamChat ?? streamChat;

  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

  // Load all persisted agents from DB on startup
  function loadPersistedAgents() {
    const dbAgents = memory.getAgents();
    for (const row of dbAgents) {
      if (!pool.has(row['id'] as string)) {
        const agent: InternalAgent = {
          id: row['id'] as string,
          goal: row['goal'] as string,
          status: row['status'] as AgentRecord['status'],
          startedAt: row['started_at'] as number,
          completedAt: row['completed_at'] as number | undefined,
          logs: row['logs'] as string[],
          model: row['model'] as string | undefined,
          projectId: (row['project_id'] as string | undefined) ?? undefined,
          parentAgentId: (row['parent_agent_id'] as string | undefined) ?? undefined,
          role: (row['role'] as string | undefined) ?? undefined,
          summary: (row['summary'] as string | undefined) ?? undefined,
        };
        pool.set(agent.id, agent);
      }
    }
  }

  // Load on init
  loadPersistedAgents();

  /**
   * Run the agent's main loop async — returns immediately with the agent record.
   */
  async function runAgent(agent: InternalAgent): Promise<void> {
    const abort = new AbortController();
    agent.abortController = abort;
    agent.pendingInstructions = [];

    const agentModel = agent.model ?? currentModel;
    log.agent('start', agent.id, agent.goal.slice(0, 80));
    broadcast('agent_update', { id: agent.id, status: 'running', model: agentModel });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: agent.goal }];
    const system = buildAgentSystemPrompt(agent.role);
    let iter = 0;
    let idleTurns = 0;
    let truncations = 0;
    // No iteration cap — agents run until they finish, fail, are aborted, or context is exhausted.

    try {
      while (true) {
        iter++;
        if (abort.signal.aborted) {
          agent.status = 'failed';
          agent.logs.push('[ABORTED by operator]');
          break;
        }

        // Check for live instructions injected by operator
        if (agent.pendingInstructions && agent.pendingInstructions.length > 0) {
          const instruction = agent.pendingInstructions.shift()!;
          log.agent('instruction', agent.id, instruction.slice(0, 60));
          messages.push({ role: 'user', content: `[LIVE INSTRUCTION FROM OPERATOR]: ${instruction}` });
          agent.logs.push(`📨 INSTRUCTION: ${instruction}`);
          broadcast('agent_instruction', { id: agent.id, instruction });
        }

        let iterText = '';
        const final = await stream({
          model: agentModel,
          maxTokens: AGENT_MAX_TOKENS,
          system,
          tools: toolRegistry.anthropicTools().filter((t) => t.name !== 'spawn_agent') as Anthropic.Tool[],
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
          memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });
        }

        // Tool calls take priority over anything said alongside them: a model
        // that writes "TASK COMPLETE" while still requesting a tool is not done.
        const toolUses = final.stop_reason === 'tool_use'
          ? final.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
          : [];

        if (!toolUses.length) {
          if (SENTINEL_COMPLETE.test(iterText)) { agent.status = 'complete'; break; }
          if (SENTINEL_FAILED.test(iterText)) { agent.status = 'failed'; break; }

          if (final.stop_reason === 'refusal') {
            agent.status = 'failed';
            agent.logs.push('[loop] the model declined this request');
            break;
          }

          if (final.stop_reason === 'max_tokens') {
            truncations++;
            if (truncations > MAX_TRUNCATIONS) {
              agent.status = 'failed';
              agent.logs.push(`[loop] output cut off ${truncations} times in a row — stopping`);
              break;
            }
            agent.logs.push('[loop] output cut off by the length limit — asking the agent to continue');
            broadcast('agent_nudge', { id: agent.id, reason: 'truncated', count: truncations });
            messages.push(assistantTurn(final.content, iterText));
            messages.push({ role: 'user', content: TRUNCATION_NUDGE });
            continue;
          }

          // Plain end_turn with no outcome declared: the model paused to
          // narrate. This used to be read as "done", which is why agents were
          // finishing after a single message.
          idleTurns++;
          if (idleTurns > MAX_IDLE_TURNS) {
            agent.status = 'complete';
            agent.logs.push(`[loop] agent stopped without declaring an outcome ${idleTurns} times — taking its last message as the result`);
            break;
          }
          agent.logs.push(`[loop] agent paused without a tool call or outcome — nudging (${idleTurns}/${MAX_IDLE_TURNS})`);
          broadcast('agent_nudge', { id: agent.id, reason: 'idle', count: idleTurns });
          messages.push(assistantTurn(final.content, iterText));
          messages.push({ role: 'user', content: IDLE_NUDGE });
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
            break;
          }

          log.agent('tool', agent.id, `${tu.name}`);
          broadcast('agent_tool', { id: agent.id, tool: tu.name, input: tu.input });

          const result = await toolRegistry.dispatch(tu.name, tu.input as Record<string, unknown>);
          const resultPreview = result.slice(0, 200).replace(/\n/g, ' ');
          agent.logs.push(`[${tu.name}] → ${resultPreview}`);
          broadcast('agent_tool_result', { id: agent.id, tool: tu.name, result: resultPreview });

          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
        }

        if (abort.signal.aborted) break;

        messages.push({ role: 'assistant', content: final.content });
        messages.push({ role: 'user', content: toolResults });
      }

    } catch (err) {
      log.error('Agent', `${agent.id}: ${err}`);
      agent.status = 'failed';
      agent.logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    agent.completedAt = Date.now();
    memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });

    log.agent(agent.status === 'complete' ? 'complete' : 'failed', agent.id);

    // Final summary line for chat
    const summary = (agent.logs[agent.logs.length - 1] ?? '').slice(0, 300);
    broadcast('agent_complete', {
      id: agent.id,
      goal: agent.goal,
      status: agent.status,
      summary,
      duration: agent.completedAt - agent.startedAt,
      model: agentModel,
    });
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
      };

      pool.set(id, agent);
      memory.saveAgent({ ...agent });
      broadcast('agent_spawn', { id, goal, status: 'running', model: currentModel, projectId, parentAgentId: opts?.parentAgentId, role: opts?.role });

      // Fire-and-forget: don't await
      runAgent(agent).catch((err) => log.error('Agent', String(err)));

      return agent;
    },

    kill(id: string): boolean {
      const agent = pool.get(id);
      if (!agent || agent.status !== 'running') return false;
      agent.abortController?.abort();
      agent.status = 'failed';
      agent.completedAt = Date.now();
      agent.logs.push('[KILLED by operator]');
      memory.saveAgent({ ...agent });
      broadcast('agent_complete', { id, status: 'failed', reason: 'killed by user' });
      return true;
    },

    /**
     * Send a live instruction to a running agent
     */
    sendInstruction(id: string, instruction: string): boolean {
      const agent = pool.get(id);
      if (!agent || agent.status !== 'running') return false;
      if (!agent.pendingInstructions) agent.pendingInstructions = [];
      agent.pendingInstructions.push(instruction);
      broadcast('agent_instruction_queued', { id, instruction });
      return true;
    },

    /**
     * List all agents (both running and historical)
     */
    list(): AgentRecord[] {
      return Array.from(pool.values()).map(({ abortController: _ac, pendingInstructions: _pi, ...rest }) => rest);
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
      const a = pool.get(id);
      if (!a) return undefined;
      const { abortController: _ac, pendingInstructions: _pi, ...rest } = a;
      return rest;
    },

    /**
     * Get full logs for an agent
     */
    getLogs(id: string): string[] {
      return pool.get(id)?.logs ?? [];
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
        if (agent.status !== 'running') {
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
