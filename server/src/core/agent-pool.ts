import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { v4 as uuid } from 'uuid';
import { memory } from './memory.js';
import { getActiveProjectId } from './active-project.js';
import { toolRegistry } from './tool-registry.js';
import { log } from './logger.js';
import type { AgentRecord } from '../types/index.js';
import type { WSHub } from '../ws.js';
import {
  getAvailableModels,
  getCurrentModel,
  getCurrentProvider,
  getProviderApiKey,
  setCurrentModel,
  setCurrentProvider,
} from './ai-provider.js';

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
  pendingInstructions?: string[];
}

const pool = new Map<string, InternalAgent>();

export function createAgentPool(ws: WSHub) {
  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

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

  loadPersistedAgents();

  async function runAnthropicLoop(
    agent: InternalAgent,
    abort: AbortController,
    agentModel: string,
    apiKey: string,
  ): Promise<void> {
    const client = new Anthropic({ apiKey });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: agent.goal }];

    while (true) {
      if (abort.signal.aborted) {
        agent.status = 'failed';
        agent.logs.push('[ABORTED by operator]');
        break;
      }

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
        broadcast('agent_token', { id: agent.id, token });
      });

      const final = await stream.finalMessage();

      if (iterText.trim()) {
        agent.logs.push(iterText.trim());
        memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });
      }

      if (/TASK COMPLETE:/i.test(iterText)) {
        agent.status = 'complete';
        break;
      }
      if (/TASK FAILED:/i.test(iterText)) {
        agent.status = 'failed';
        break;
      }

      if (final.stop_reason !== 'tool_use') {
        agent.status = 'complete';
        break;
      }

      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (!toolUses.length) {
        agent.status = 'complete';
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
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
  }

  async function runGeminiLoop(
    agent: InternalAgent,
    abort: AbortController,
    agentModel: string,
    apiKey: string,
  ): Promise<void> {
    const client = new GoogleGenAI({ apiKey });
    const contents: Content[] = [{ role: 'user', parts: [{ text: agent.goal }] }];

    while (true) {
      if (abort.signal.aborted) {
        agent.status = 'failed';
        agent.logs.push('[ABORTED by operator]');
        break;
      }

      if (agent.pendingInstructions && agent.pendingInstructions.length > 0) {
        const instruction = agent.pendingInstructions.shift()!;
        log.agent('instruction', agent.id, instruction.slice(0, 60));
        contents.push({ role: 'user', parts: [{ text: `[LIVE INSTRUCTION FROM OPERATOR]: ${instruction}` }] });
        agent.logs.push(`📨 INSTRUCTION: ${instruction}`);
        broadcast('agent_instruction', { id: agent.id, instruction });
      }

      const stream = await client.models.generateContentStream({
        model: agentModel,
        contents,
        config: {
          systemInstruction: AGENT_SYSTEM_PROMPT,
          tools: [{ functionDeclarations: toolRegistry.geminiTools().filter((t) => t.name !== 'spawn_agent') }],
        },
      });

      let iterText = '';
      let finalChunk: Awaited<ReturnType<typeof client.models.generateContent>> | undefined;
      for await (const chunk of stream) {
        finalChunk = chunk;
        if (!chunk.text) continue;
        iterText += chunk.text;
        broadcast('agent_token', { id: agent.id, token: chunk.text });
      }

      if (iterText.trim()) {
        agent.logs.push(iterText.trim());
        memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });
      }

      if (/TASK COMPLETE:/i.test(iterText)) {
        agent.status = 'complete';
        break;
      }
      if (/TASK FAILED:/i.test(iterText)) {
        agent.status = 'failed';
        break;
      }

      const functionCalls = finalChunk?.functionCalls ?? [];
      if (!functionCalls.length) {
        agent.status = 'complete';
        break;
      }

      const assistantParts: Part[] = [];
      if (iterText) assistantParts.push({ text: iterText });
      const responseParts: Part[] = [];

      for (const call of functionCalls) {
        if (abort.signal.aborted) {
          agent.status = 'failed';
          break;
        }

        const name = call.name ?? '';
        if (!name) continue;
        const input =
          call.args && typeof call.args === 'object' && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {};

        log.agent('tool', agent.id, name);
        broadcast('agent_tool', { id: agent.id, tool: name, input });

        const result = await toolRegistry.dispatch(name, input);
        const resultPreview = result.slice(0, 200).replace(/\n/g, ' ');
        agent.logs.push(`[${name}] → ${resultPreview}`);
        broadcast('agent_tool_result', { id: agent.id, tool: name, result: resultPreview });

        assistantParts.push({ functionCall: { id: call.id, name, args: input } });
        responseParts.push({
          functionResponse: {
            id: call.id,
            name,
            response: { output: result },
          },
        });
      }

      if (abort.signal.aborted) break;
      if (!responseParts.length) {
        agent.status = 'complete';
        break;
      }

      contents.push({ role: 'model', parts: assistantParts });
      contents.push({ role: 'user', parts: responseParts });
    }
  }

  async function runAgent(agent: InternalAgent): Promise<void> {
    const abort = new AbortController();
    agent.abortController = abort;
    agent.pendingInstructions = [];

    const provider = getCurrentProvider();
    const agentModel = agent.model ?? getCurrentModel(provider);
    const apiKey = getProviderApiKey(provider);
    if (!apiKey) {
      agent.status = 'failed';
      agent.logs.push(`Missing ${provider} API key. Configure setup first.`);
      agent.completedAt = Date.now();
      memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });
      broadcast('agent_complete', {
        id: agent.id,
        goal: agent.goal,
        status: agent.status,
        summary: agent.logs[agent.logs.length - 1],
        duration: agent.completedAt - agent.startedAt,
        model: agentModel,
        provider,
      });
      return;
    }

    log.agent('start', agent.id, agent.goal.slice(0, 80));
    broadcast('agent_update', { id: agent.id, status: 'running', model: agentModel, provider });

    try {
      if (provider === 'anthropic') {
        await runAnthropicLoop(agent, abort, agentModel, apiKey);
      } else {
        await runGeminiLoop(agent, abort, agentModel, apiKey);
      }
    } catch (err) {
      log.error('Agent', `${agent.id}: ${err}`);
      agent.status = 'failed';
      agent.logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    agent.completedAt = Date.now();
    memory.saveAgent({ ...agent, logs: agent.logs, model: agentModel });

    log.agent(agent.status === 'complete' ? 'complete' : 'failed', agent.id);

    const summary = (agent.logs[agent.logs.length - 1] ?? '').slice(0, 300);
    broadcast('agent_complete', {
      id: agent.id,
      goal: agent.goal,
      status: agent.status,
      summary,
      duration: agent.completedAt - agent.startedAt,
      model: agentModel,
      provider,
    });
  }

  return {
    spawn(goal: string, opts?: { projectId?: string; parentAgentId?: string; role?: string }): AgentRecord {
      const id = uuid();
      const provider = getCurrentProvider();
      const projectId = opts?.projectId ?? getActiveProjectId() ?? undefined;
      const agent: InternalAgent = {
        id,
        goal,
        status: 'running',
        startedAt: Date.now(),
        logs: [],
        model: getCurrentModel(provider),
        projectId,
        parentAgentId: opts?.parentAgentId,
        role: opts?.role,
      };

      pool.set(id, agent);
      memory.saveAgent({ ...agent });
      broadcast('agent_spawn', {
        id,
        goal,
        status: 'running',
        model: agent.model,
        provider,
        projectId,
        parentAgentId: opts?.parentAgentId,
        role: opts?.role,
      });

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

    sendInstruction(id: string, instruction: string): boolean {
      const agent = pool.get(id);
      if (!agent || agent.status !== 'running') return false;
      if (!agent.pendingInstructions) agent.pendingInstructions = [];
      agent.pendingInstructions.push(instruction);
      broadcast('agent_instruction_queued', { id, instruction });
      return true;
    },

    list(): AgentRecord[] {
      return Array.from(pool.values()).map(({ abortController: _ac, pendingInstructions: _pi, ...rest }) => rest);
    },

    listRunning(): AgentRecord[] {
      return this.list().filter((a) => a.status === 'running');
    },

    listHistory(): AgentRecord[] {
      return this.list().filter((a) => a.status !== 'running');
    },

    get(id: string): AgentRecord | undefined {
      const a = pool.get(id);
      if (!a) return undefined;
      const { abortController: _ac, pendingInstructions: _pi, ...rest } = a;
      return rest;
    },

    getLogs(id: string): string[] {
      return pool.get(id)?.logs ?? [];
    },

    setModel(model: string): boolean {
      const ok = setCurrentModel(model, getCurrentProvider());
      if (!ok) return false;
      broadcast('model_changed', { model, provider: getCurrentProvider() });
      return true;
    },

    getModel(): string {
      return getCurrentModel(getCurrentProvider());
    },

    getAvailableModels(): string[] {
      return getAvailableModels(getCurrentProvider());
    },

    getProvider(): string {
      return getCurrentProvider();
    },

    setProvider(provider: string): boolean {
      if (provider !== 'anthropic' && provider !== 'gemini') return false;
      setCurrentProvider(provider);
      broadcast('provider_changed', { provider, model: getCurrentModel(provider) });
      return true;
    },

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

    reloadFromDB(): void {
      loadPersistedAgents();
    },
  };
}
