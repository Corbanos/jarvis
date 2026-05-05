import type { ToolDefinition } from '../types/index.js';

let _spawnFn: ((goal: string) => { id: string; goal: string }) | null = null;

export function setSpawnFn(fn: (goal: string) => { id: string; goal: string }) {
  _spawnFn = fn;
}

export const spawnAgentTool: ToolDefinition = {
  name: 'spawn_agent',
  description: `Spawn a dedicated autonomous sub-agent to handle a substantial task IN THE BACKGROUND while you keep talking to the operator.

USE THIS TOOL WHENEVER THE TASK INVOLVES:
- Writing or modifying code (any file changes, refactors, fixes)
- Multi-step research that requires several tool calls
- Long-running shell operations (builds, installs, tests)
- File system reorganization or batch edits
- Any task you estimate will take more than ~30 seconds of work

DO NOT use spawn_agent for:
- Quick single-tool answers (one file read, one weather lookup)
- Conversation, opinions, brief responses
- Tasks the operator clearly wants you to do live

After spawning, give the operator a one-line acknowledgement and STOP.
The agent runs autonomously, posts live progress to the agent panel, and notifies when complete.

Example flow:
  Operator: "Add a dark mode toggle to the settings page"
  You: spawn_agent(goal="Add a dark mode toggle to settings page in /path/to/file. Wire it through the theme provider, persist to localStorage, test the toggle works.")
  You: "On it, sir. Spawning a worker — I'll let you know when it's done."`,
  input_schema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'A complete, self-contained goal for the sub-agent. Include all relevant file paths, requirements, success criteria. The agent will not be able to ask follow-up questions.',
      },
    },
    required: ['goal'],
  },
  async handler(input) {
    if (!_spawnFn) return 'Error: Agent pool not initialized';
    const goal = input['goal'] as string;
    const agent = _spawnFn(goal);
    return `Sub-agent ${agent.id.slice(0, 8)} spawned and running in background. Goal: "${agent.goal.slice(0, 100)}". Live progress visible in agent panel; you'll be notified when complete.`;
  },
};
