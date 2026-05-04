import type { ToolDefinition } from '../types/index.js';

const tools = new Map<string, ToolDefinition>();

export const toolRegistry = {
  register(tool: ToolDefinition) {
    tools.set(tool.name, tool);
    console.log(`[JARVIS] Tool registered: ${tool.name}`);
  },

  get(name: string): ToolDefinition | undefined {
    return tools.get(name);
  },

  all(): ToolDefinition[] {
    return Array.from(tools.values());
  },

  // Anthropic-compatible tool list (without handler)
  anthropicTools() {
    return this.all().map(({ handler: _h, ...rest }) => rest);
  },

  async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = tools.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;
    try {
      return await tool.handler(input);
    } catch (err) {
      return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
