import type { ToolDefinition } from '../types/index.js';

// Will be injected at runtime
let _spawnFn: ((goal: string) => { id: string; goal: string }) | null = null;

export function setSpawnFn(fn: (goal: string) => { id: string; goal: string }) {
  _spawnFn = fn;
}

export const spawnAgentTool: ToolDefinition = {
  name: 'spawn_agent',
  description:
    'Spawn a dedicated sub-agent to handle a specific goal asynchronously. The agent runs independently and reports back. Use for long-running tasks, parallel work, or specialized subtasks.',
  input_schema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Clear, specific goal for the sub-agent to accomplish',
      },
    },
    required: ['goal'],
  },
  async handler(input) {
    if (!_spawnFn) return 'Error: Agent pool not initialized';
    const goal = input['goal'] as string;
    const agent = _spawnFn(goal);
    return `Sub-agent spawned. ID: ${agent.id}. Goal: "${agent.goal}". The agent is running asynchronously. You can reference agent ${agent.id} for status updates.`;
  },
};
