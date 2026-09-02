import type { ToolDefinition } from '../types/index.js';

let _broadcast: ((event: string, payload: Record<string, unknown>) => void) | null = null;

export function setModuleBroadcast(fn: (event: string, payload: Record<string, unknown>) => void) {
  _broadcast = fn;
}

const MODULE_TYPES = ['chat', 'agents', 'scheduler', 'telemetry', 'system', 'cad', 'cad-preview', 'weather', 'printer', 'worldview', 'browser', 'shell', 'wolfram'] as const;

export const moduleTool: ToolDefinition = {
  name: 'module',
  description: `Control the HQ workspace — open, close, or focus modules in the operator's HUD.

Use whenever the operator asks to:
- "Show me X panel"
- "Open agents/scheduler/cad/printer/worldview/system/telemetry/shell"
- "Close that"
- "Hide everything except chat"

Modules:
- chat: Jarvis interface (the main one)
- agents: Active sub-agents
- scheduler: Scheduled tasks
- telemetry: Live event feed
- system: System telemetry (uptime, latency, voice status)
- cad: CAD library (preview thumbnails of recent designs)
- printer: Bambu printer status
- worldview: Cesium globe with cameras + satellites
- browser: Browser preview
- shell: Quick shell terminal
- wolfram: Wolfram|Alpha computation panel (query box + result pods)`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['open', 'close', 'focus'], description: 'open, close, or focus a module' },
      type: { type: 'string', enum: [...MODULE_TYPES], description: 'Which module' },
    },
    required: ['action', 'type'],
  },
  async handler(input) {
    const action = input['action'] as string;
    const type = input['type'] as string;
    if (!_broadcast) return 'Module control unavailable.';
    _broadcast('module', { action, type });
    return `${action.toUpperCase()} module: ${type}`;
  },
};
