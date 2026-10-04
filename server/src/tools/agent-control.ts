/**
 * Live control over already-spawned sub-agents: resume a dead one in place,
 * steer a running one mid-flight, pause or stop it at a safe point, or read
 * its current state. Wired to the agent pool from index.ts.
 */
import type { AgentRecord, ToolDefinition } from '../types/index.js';

export interface AgentControlHost {
  resolve(query: string): string | undefined;
  matchIds(query: string): string[];
  get(id: string): AgentRecord | undefined;
  list(): AgentRecord[];
  getLogs(id: string): string[];
  resume(query: string, note?: string): { ok: boolean; error?: string; agent?: AgentRecord };
  steer(query: string, message: string): { ok: boolean; error?: string; agent?: AgentRecord; delivery?: 'live' | 'queued' };
  pause(query: string): { ok: boolean; error?: string; agent?: AgentRecord };
  stop(query: string): { ok: boolean; error?: string; agent?: AgentRecord };
}

let host: AgentControlHost | null = null;

export function setAgentControlHost(h: AgentControlHost) {
  host = h;
}

function short(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function describe(a: AgentRecord): string {
  const parts = [
    `${short(a.id)} — ${a.status.toUpperCase()}`,
    a.role ? `role=${a.role}` : '',
    `iterations=${a.iterations ?? 0}`,
    (a.resumeCount ?? 0) > 0 ? `resumed=${a.resumeCount}` : '',
    a.pendingControl ? `pending=${a.pendingControl}` : '',
    (a.pendingInstructions?.length ?? 0) > 0 ? `queuedInstructions=${a.pendingInstructions!.length}` : '',
    a.lastError ? `lastError="${a.lastError.slice(0, 160)}"` : '',
  ].filter(Boolean);
  return `${parts.join(' · ')}\nGoal: ${a.goal.slice(0, 200)}`;
}

export const agentControlTool: ToolDefinition = {
  name: 'agent_control',
  description: `Control a sub-agent that ALREADY EXISTS — resume it, steer it mid-flight, pause it, stop it, or read its status. Use this instead of spawn_agent whenever the operator refers to an agent that is already there ("resume agent AECF653A", "tell that agent to skip the tests", "pause the agent", "kill it", "what's that agent doing").

Actions:
- resume — re-enter a FAILED / STOPPED / PAUSED / COMPLETE agent's loop IN PLACE: same agent id, its whole prior transcript rehydrated as context, plus a note explaining why it is resuming, and its iteration budget reset. This is the fix for "the agent died on a provider 429 / rate limit / crash and I've sorted the credentials" — never re-spawn a fresh agent and retype the context, resume this one. Pass 'note' with what changed ("new API credentials in place, rate limit cleared").
- steer — inject a live instruction. A RUNNING agent picks it up at its next loop iteration as "OPERATOR INTERJECTION: ..." and must adjust course. A paused/stopped/failed agent keeps it queued and receives it when resumed. Use for course corrections: "skip the tests", "use the other file", "stop refactoring, just fix the bug".
- pause — cooperative pause at the next safe point (an in-flight tool call finishes first). Resumable.
- stop — cooperative stop, same safe-point semantics, still resumable later.
- status — report the agent's status, iterations, queued instructions, last error and recent log lines.

Agent ids may be abbreviated: an 8-char prefix as shown in the HUD ("AECF653A", "a-aecf65") is matched case-insensitively. Omit agentId with action=status to list every agent.

After acting, tell the operator in ONE short line what happened. Do not narrate the agent's work afterwards — the agent panel shows it live.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['resume', 'steer', 'pause', 'stop', 'status'],
        description: 'What to do to the agent.',
      },
      agentId: {
        type: 'string',
        description: 'Agent id or a short prefix of it, e.g. "AECF653A". Case-insensitive. Optional for action=status (lists all).',
      },
      message: {
        type: 'string',
        description: 'For action=steer: the instruction to inject, phrased as an order to the agent.',
      },
      note: {
        type: 'string',
        description: 'For action=resume: what changed / why it is safe to continue (e.g. "rate limit cleared, new key installed").',
      },
    },
    required: ['action'],
  },
  async handler(input) {
    if (!host) return 'Error: Agent pool not initialized';
    const action = String(input['action'] ?? '').toLowerCase();
    const query = (input['agentId'] as string | undefined)?.trim();

    if (action === 'status' && !query) {
      const all = host.list();
      if (!all.length) return 'No agents have been spawned.';
      const lines = all
        .slice()
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 20)
        .map((a) => `${short(a.id)} ${a.status.toUpperCase()}${a.pendingControl ? ` (${a.pendingControl} pending)` : ''} — ${a.goal.slice(0, 80)}`);
      return `Agents (newest first):\n${lines.join('\n')}`;
    }

    if (!query) return `Error: agentId required for action=${action}`;

    const matches = host.matchIds(query);
    if (!matches.length) return `No agent matches "${query}". Use action=status with no agentId to list them.`;
    if (matches.length > 1) {
      return `"${query}" is ambiguous — matches ${matches.map(short).join(', ')}. Give more characters of the id.`;
    }
    const id = matches[0]!;

    switch (action) {
      case 'status': {
        const agent = host.get(id);
        if (!agent) return `No agent ${short(id)}.`;
        const logs = host.getLogs(id).slice(-8).map((l) => `  ${l.slice(0, 200)}`).join('\n');
        return `${describe(agent)}\nRecent log:\n${logs || '  (nothing logged yet)'}`;
      }
      case 'resume': {
        const res = host.resume(id, input['note'] as string | undefined);
        if (!res.ok) return `Could not resume ${short(id)}: ${res.error}`;
        return `Agent ${short(id)} resumed in place (same id, prior transcript restored, iteration budget reset). Reason given: ${(input['note'] as string | undefined) ?? 'previous failure'}.`;
      }
      case 'steer': {
        const message = (input['message'] as string | undefined)?.trim();
        if (!message) return 'Error: message required for action=steer';
        const res = host.steer(id, message);
        if (!res.ok) return `Could not steer ${short(id)}: ${res.error}`;
        return res.delivery === 'live'
          ? `Interjection delivered to ${short(id)} — it will act on it at its next loop iteration.`
          : `Agent ${short(id)} is ${res.agent?.status ?? 'not running'}; the instruction is queued and will be delivered when it is resumed.`;
      }
      case 'pause': {
        const res = host.pause(id);
        if (!res.ok) return `Could not pause ${short(id)}: ${res.error}`;
        return `Pause requested for ${short(id)} — it will stop at the next safe point and stays resumable.`;
      }
      case 'stop': {
        const res = host.stop(id);
        if (!res.ok) return `Could not stop ${short(id)}: ${res.error}`;
        return `Stop requested for ${short(id)} — it will exit cleanly at the next safe point and can be resumed later.`;
      }
      default:
        return `Error: unknown action "${action}". Use resume | steer | pause | stop | status.`;
    }
  },
};
