import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition } from '../types/index.js';

export const filesystemTool: ToolDefinition = {
  name: 'filesystem',
  description: 'Read, write, or list files and directories on the host machine.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'list', 'mkdir'],
        description: 'Operation to perform',
      },
      path: { type: 'string', description: 'Absolute or relative file/directory path' },
      content: { type: 'string', description: 'Content to write (for write action)' },
    },
    required: ['action', 'path'],
  },
  async handler(input) {
    const action = input['action'] as string;
    const path = input['path'] as string;
    const content = input['content'] as string | undefined;

    try {
      switch (action) {
        case 'read':
          return readFileSync(path, 'utf-8');
        case 'write':
          if (content === undefined) return 'Error: content required for write';
          writeFileSync(path, content, 'utf-8');
          return `Written ${content.length} bytes to ${path}`;
        case 'list': {
          const entries = readdirSync(path, { withFileTypes: true });
          return entries.map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
        }
        case 'mkdir':
          mkdirSync(path, { recursive: true });
          return `Directory created: ${path}`;
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
