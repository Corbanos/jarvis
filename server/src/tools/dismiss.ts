import type { ToolDefinition } from '../types/index.js';

let _onDismiss: (() => void) | null = null;

export function setDismissHandler(fn: () => void) {
  _onDismiss = fn;
}

export const dismissTool: ToolDefinition = {
  name: 'dismiss',
  description: `Call this tool when the operator is ending the conversation or dismissing you.
Examples of when to call: "that's all", "thanks Jarvis", "I'm done", "go to sleep", "shut up", "leave me alone", "go away", "ok bye".

After calling, give a brief farewell line ("Of course, sir.", "Standing down.") and stop responding.`,
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Brief reason — what the operator said that indicated dismissal.' },
    },
  },
  async handler(input) {
    const reason = (input['reason'] as string) ?? 'operator dismissed';
    _onDismiss?.();
    return `Dismissed (${reason}). Going to sleep.`;
  },
};
