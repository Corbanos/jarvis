import { spawn } from 'child_process';
import { v4 as uuid } from 'uuid';
import { memory } from './memory.js';
import type { AgentRecord } from '../types/index.js';
import type { WSHub } from '../ws.js';

const pool = new Map<string, AgentRecord>();

export function createAgentPool(ws: WSHub) {
  function broadcast(type: string, payload: Record<string, unknown>) {
    ws.broadcast({ type: type as never, payload, timestamp: Date.now() });
  }

  return {
    spawn(goal: string, env?: Record<string, string>): AgentRecord {
      const id = uuid();
      const agent: AgentRecord = {
        id,
        goal,
        status: 'spawning',
        startedAt: Date.now(),
        logs: [],
      };

      pool.set(id, agent);
      memory.saveAgent(agent);
      broadcast('agent_spawn', { id, goal, status: 'spawning' });

      // Spawn as a child Node process running a lightweight agent loop
      const child = spawn(
        process.execPath,
        ['-e', buildAgentScript(id, goal, env ?? {})],
        {
          env: { ...process.env, ...env, JARVIS_AGENT_ID: id, JARVIS_PORT: process.env['JARVIS_PORT'] ?? '7777' },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      agent.pid = child.pid;
      agent.status = 'running';
      memory.saveAgent(agent);
      broadcast('agent_update', { id, status: 'running', pid: child.pid });

      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        agent.logs.push(line);
        broadcast('agent_update', { id, log: line });
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        agent.logs.push(`[ERR] ${line}`);
      });

      child.on('close', (code) => {
        agent.status = code === 0 ? 'complete' : 'failed';
        agent.completedAt = Date.now();
        memory.saveAgent(agent);
        pool.set(id, agent);
        broadcast('agent_complete', { id, status: agent.status, code });
      });

      return agent;
    },

    kill(id: string): boolean {
      const agent = pool.get(id);
      if (!agent || !agent.pid) return false;
      try {
        process.kill(agent.pid, 'SIGTERM');
        agent.status = 'failed';
        agent.completedAt = Date.now();
        memory.saveAgent(agent);
        broadcast('agent_complete', { id, status: 'failed', reason: 'killed' });
        return true;
      } catch {
        return false;
      }
    },

    list(): AgentRecord[] {
      return Array.from(pool.values());
    },

    get(id: string): AgentRecord | undefined {
      return pool.get(id);
    },
  };
}

function buildAgentScript(id: string, goal: string, _env: Record<string, string>): string {
  // Minimal agent: posts back to parent via stdout, hits JARVIS API
  return `
const https = require('http');
const port = process.env.JARVIS_PORT || '7777';

function log(msg) {
  process.stdout.write(msg + '\\n');
}

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ host: 'localhost', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

log('[Agent ${id}] Starting — goal: ${goal.replace(/'/g, "\\'")}');

(async () => {
  try {
    const result = await post('/api/chat', {
      message: ${JSON.stringify(goal)},
      sessionId: 'agent-${id}',
      isAgent: true,
      agentId: '${id}'
    });
    log('[Agent ${id}] Complete: ' + result.substring(0, 200));
  } catch (err) {
    log('[Agent ${id}] Error: ' + err.message);
    process.exit(1);
  }
})();
  `;
}
