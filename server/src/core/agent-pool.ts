import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import { memory } from './memory.js';
import { toolRegistry } from './tool-registry.js';
import { log } from './logger.js';
import type { AgentRecord } from '../types/index.js';
import type { WSHub } from '../ws.js';

const AGENT_SYSTEM_PROMPT = `You are a J.A.R.V.I.S. sub-agent — an autonomous worker spawned by the main Jarvis to complete a specific goal.

## Your role
- You have a SINGLE, FOCUSED goal. Pursue it relentlessly.
- You have full tool access: shell, filesystem, browser, web search.
- Work autonomously. Do not ask questions; make reasonable decisions.
- When complete, return a concise SUMMARY of what you did and the result.

## Output format
- Narrate progress briefly as you work (1-2 sentences per major step).
- Use code blocks for code/file contents.
- End with: "TASK COMPLETE: <one-line summary>" or "TASK FAILED: <reason>".

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

// Current model for all agents
// Default to the latest Sonnet — best balance of quality, speed, and cost.
let currentModel = 'claude-sonnet-4-6';

// Available models, ordered newest → oldest. Verified against
// https://api.anthropic.com/v1/models on 2026-05-05.
export const AVAILABLE_MODELS = [
  'claude-opus-4-7',           // newest Opus
  'claude-sonnet-4-6',         // newest Sonnet (default)
  'claude-haiku-4-5-20251001', // newest Haiku
  'claude-opus-4-6',           // previous Opus
  'claude-sonnet-4-5-20250929',// previous Sonnet
  'claude-opus-4-5-20251101',  // earlier Opus 4.5
] as const;

export type ClaudeModel = typeof AVAILABLE_MODELS[number];

export function createAgentPool(ws: WSHub) {
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

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
    let iter = 0;
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

        const stream = client.messages.stream({
          model: agentModel,
          max_tokens: 8192,
          system: AGENT_SYSTEM_PROMPT,
          tools: toolRegistry.anthropicTools().filter((t) => t.name !== 'spawn_agent') as Anthropic.Tool[],
          messages,
        });

        let iterText = '';
        stream.on('text', (token: string) => {
          iterText += token;
          // Stream tokens to HUD agent panel
          broadcast('agent_token', { id: agent.id, token });
        });

        const final = await stream.finalMessage();

        if (iterText.trim()) {
          agent.logs.push(iterText.trim());
          memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });
        }

        // Check for completion sentinel
        if (/TASK COMPLETE:/i.test(iterText)) {
          agent.status = 'complete';
          break;
        }
        if (/TASK FAILED:/i.test(iterText)) {
          agent.status = 'failed';
          break;
        }

        if (final.stop_reason !== 'tool_use') {
          // Model stopped without sentinel — assume done
          agent.status = 'complete';
          break;
        }

        // Execute tool calls
        const toolUses = final.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        if (!toolUses.length) {
          agent.status = 'complete';
          break;
        }

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
    spawn(goal: string, _env?: Record<string, string>): AgentRecord {
      const id = uuid();
      const agent: InternalAgent = {
        id,
        goal,
        status: 'running',
        startedAt: Date.now(),
        logs: [],
        model: currentModel,
      };

      pool.set(id, agent);
      memory.saveAgent({ ...agent, model: currentModel });
      broadcast('agent_spawn', { id, goal, status: 'running', model: currentModel });

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
