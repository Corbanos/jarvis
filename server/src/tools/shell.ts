import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../types/index.js';

const execAsync = promisify(exec);

export const shellTool: ToolDefinition = {
  name: 'shell',
  description: 'Execute a shell command on the host machine. Has full system access. Returns stdout and stderr.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  async handler(input) {
    const command = input['command'] as string;
    const timeout = (input['timeout'] as number | undefined) ?? 30000;
    try {
      const { stdout, stderr } = await execAsync(command, { timeout, shell: '/bin/zsh' });
      return [stdout, stderr ? `STDERR: ${stderr}` : ''].filter(Boolean).join('\n').trim() || '(no output)';
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return `Error: ${e.message}\nstdout: ${e.stdout ?? ''}\nstderr: ${e.stderr ?? ''}`;
    }
  },
};
