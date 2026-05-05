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
}

const pool = new Map<string, InternalAgent>();

export function createAgentPool(ws: WSHub) {
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

  /**
   * Run the agent's main loop async — returns immediately with the agent record.
   */
  async function runAgent(agent: InternalAgent): Promise<void> {
    const abort = new AbortController();
    agent.abortController = abort;

    log.agent('start', agent.id, agent.goal.slice(0, 80));
    broadcast('agent_update', { id: agent.id, status: 'running' });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: agent.goal }];
    let iter = 0;
    const MAX_ITER = 25;

    try {
      while (iter < MAX_ITER) {
        iter++;
        if (abort.signal.aborted) {
          agent.status = 'failed';
          break;
        }

        const stream = client.messages.stream({
          model: 'claude-opus-4-5',
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
          memory.saveAgent({ ...agent, logs: agent.logs });
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
          log.agent('tool', agent.id, `${tu.name}`);
          broadcast('agent_tool', { id: agent.id, tool: tu.name, input: tu.input });

          const result = await toolRegistry.dispatch(tu.name, tu.input as Record<string, unknown>);
          const resultPreview = result.slice(0, 200).replace(/\n/g, ' ');
          agent.logs.push(`[${tu.name}] → ${resultPreview}`);
          broadcast('agent_tool_result', { id: agent.id, tool: tu.name, result: resultPreview });

          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
        }

        messages.push({ role: 'assistant', content: final.content });
        messages.push({ role: 'user', content: toolResults });
      }

      if (iter >= MAX_ITER && agent.status === 'running') {
        agent.status = 'failed';
        agent.logs.push('Agent hit max iterations');
      }
    } catch (err) {
      log.error('Agent', `${agent.id}: ${err}`);
      agent.status = 'failed';
      agent.logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    agent.completedAt = Date.now();
    memory.saveAgent({ ...agent, logs: agent.logs });

    log.agent(agent.status === 'complete' ? 'complete' : 'failed', agent.id);

    // Final summary line for chat
    const summary = (agent.logs[agent.logs.length - 1] ?? '').slice(0, 300);
    broadcast('agent_complete', {
      id: agent.id,
      goal: agent.goal,
      status: agent.status,
      summary,
      duration: agent.completedAt - agent.startedAt,
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
      };

      pool.set(id, agent);
      memory.saveAgent({ ...agent });
      broadcast('agent_spawn', { id, goal, status: 'running' });

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
      memory.saveAgent({ ...agent });
      broadcast('agent_complete', { id, status: 'failed', reason: 'killed by user' });
      return true;
    },

    list(): AgentRecord[] {
      return Array.from(pool.values()).map(({ abortController: _ac, ...rest }) => rest);
    },

    get(id: string): AgentRecord | undefined {
      const a = pool.get(id);
      if (!a) return undefined;
      const { abortController: _ac, ...rest } = a;
      return rest;
    },
  };
}
