import type { ToolDefinition } from '../types/index.js';

let _spawnFn: ((goal: string, opts?: { projectId?: string; parentAgentId?: string; role?: string }) => { id: string; goal: string }) | null = null;

export function setSpawnFn(fn: (goal: string, opts?: { projectId?: string; parentAgentId?: string; role?: string }) => { id: string; goal: string }) {
  _spawnFn = fn;
}

export const spawnAgentTool: ToolDefinition = {
  name: 'spawn_agent',
  description: `Spawn a dedicated autonomous sub-agent that runs a TASK LOOP in the background until done. The agent has full tool access and IT KEEPS LOOPING (test → fix → test) until the goal is achieved or it explicitly fails.

CRITICAL — when to spawn (your default):
- ANY bug investigation or fix. The operator says "X is broken" → spawn an agent and let it loop. Do NOT debug inline. Spawning is faster, doesn't burn your context, and the agent will iterate. You spent 3 minutes once doing this inline and never fixed it. Don't repeat that.
- ANY code change (file edits, refactors, builds, tests, installs).
- ANY multi-step research or shell work.
- Anything beyond a one-tool-call answer.

Inline (no agent) is ONLY for:
- Conversation, opinions, jokes, status reports.
- One-shot tool calls (one weather lookup, one file read, one nearby search).
- Quick acknowledgements.

The agent loops until completion — that's its job, not yours. After spawning, give the operator ONE short line ("On it, sir.") and stop. Do not narrate the agent's progress in your reply; the agent panel shows it live.

GOAL FORMAT (very important — agents cannot ask you follow-ups):
A good goal is self-contained, has explicit success criteria, and lists the files / commands / endpoints involved. Bad goal: "fix the drawing pad". Good goal:

  Fix the 404 returned by the in-HUD app loader for slug=drawing-pad-2.
  Repro: open AppRunner module, iframe src goes to '/library/drawing-pad-2/'.
  Server (Fastify @ :7777) has the route and serves 200 in curl.
  Browser hits next-dev (:3001) → 404 because next.config rewrite covers
  /api/* and /ws but NOT /library/*. Fix by adding /library/* rewrites
  to next.config.ts. Verify by reloading the iframe and checking the
  response is 200 + the actual HTML, not the Next 404 page.
  Success: launching the app from the LIBRARY module shows the rendered
  app inside the iframe, not a 404.

ROLES (pass via 'role' arg):
  - 'debug'   — diagnose + fix a bug. Loops test→edit→test until pass.
  - 'builder' — write new code/feature.
  - 'research'— gather info, summarise.
  - 'manager' — long-running coordinator that spawns child agents.
  Default: 'worker'. Role mostly affects how the operator sees it in
  the agent panel; the agent itself reads it as context.

PROJECT LINKAGE:
If the operator has INITed a project, the spawned agent is automatically
tied to that project — it shows up in that project's folder in the
agent panel. You don't need to pass projectId explicitly unless the
agent is for a DIFFERENT project than the active one.`,
  input_schema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'A complete, self-contained goal — paths, commands, success criteria. The agent cannot ask follow-up questions.',
      },
      role: {
        type: 'string',
        enum: ['debug', 'builder', 'research', 'manager', 'worker'],
        description: 'Optional role hint for the operator panel + the agent role-context. Default worker.',
      },
      projectId: {
        type: 'string',
        description: 'Optional explicit project id. Defaults to the currently INITed project if any.',
      },
      parentAgentId: {
        type: 'string',
        description: 'Optional parent agent id (for manager-spawned children).',
      },
    },
    required: ['goal'],
  },
  async handler(input) {
    if (!_spawnFn) return 'Error: Agent pool not initialized';
    const goal = input['goal'] as string;
    const opts = {
      role: input['role'] as string | undefined,
      projectId: input['projectId'] as string | undefined,
      parentAgentId: input['parentAgentId'] as string | undefined,
    };
    const agent = _spawnFn(goal, opts);
    return `Sub-agent ${agent.id.slice(0, 8)} spawned (role=${opts.role ?? 'worker'}). Goal: "${agent.goal.slice(0, 100)}". Live progress visible in the agent panel; you'll be notified when complete.`;
  },
};
