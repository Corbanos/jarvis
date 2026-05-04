import type { ToolDefinition } from '../types/index.js';
import { createJob, listJobs, deleteJob, toggleJob } from '../modules/scheduler.js';

export const scheduleTool: ToolDefinition = {
  name: 'schedule',
  description: `Schedule tasks for Jarvis to do later. Supports natural language timing.
Examples:
- "in 30 minutes" → once, 30 min from now
- "at 9:00 am" → once at that time today (or tomorrow)
- "every 1 hour" → recurring
Use this when the user asks Jarvis to do something later, remind them, or check something periodically.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'delete', 'enable', 'disable'],
        description: 'Schedule action',
      },
      name: { type: 'string', description: 'Human-readable name for the task' },
      prompt: { type: 'string', description: 'What Jarvis should do at that time (the command/prompt to execute)' },
      schedule: { type: 'string', description: 'When: "in 30 minutes", "at 9:00 am", "every 1 hour", "in 2 hours"' },
      type: { type: 'string', enum: ['once', 'interval'], description: 'Once or recurring (default: once)' },
      jobId: { type: 'string', description: 'Job ID (for delete/enable/disable)' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    try {
      switch (action) {
        case 'create': {
          if (!input['prompt'] || !input['schedule']) return 'Error: prompt and schedule required';
          const job = createJob({
            name: (input['name'] as string) ?? 'Unnamed Task',
            prompt: input['prompt'] as string,
            schedule: input['schedule'] as string,
            scheduleType: (input['type'] as 'once' | 'interval') ?? 'once',
          });
          const when = new Date(job.nextRun).toLocaleString();
          return `Scheduled: "${job.name}" → ${when}\nID: ${job.id}`;
        }
        case 'list': {
          const jobs = listJobs();
          if (!jobs.length) return 'No scheduled tasks.';
          return jobs.map((j) => {
            const when = new Date(j.nextRun).toLocaleString();
            const status = j.enabled ? '✓' : '✗';
            return `${status} [${j.id.slice(0, 8)}] ${j.name} — ${when} (${j.scheduleType})`;
          }).join('\n');
        }
        case 'delete': {
          if (!input['jobId']) return 'Error: jobId required';
          const ok = deleteJob(input['jobId'] as string);
          return ok ? 'Task deleted.' : 'Task not found.';
        }
        case 'enable': {
          if (!input['jobId']) return 'Error: jobId required';
          toggleJob(input['jobId'] as string, true);
          return 'Task enabled.';
        }
        case 'disable': {
          if (!input['jobId']) return 'Error: jobId required';
          toggleJob(input['jobId'] as string, false);
          return 'Task disabled.';
        }
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Schedule error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
