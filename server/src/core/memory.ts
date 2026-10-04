import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.jarvis');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'jarvis.db'));

// Init schema
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    logs TEXT NOT NULL DEFAULT '[]',
    pid INTEGER,
    model TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    next_run INTEGER,
    last_run INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

// Forward-only migrations. Every add is guarded by a PRAGMA table_info check
// (and a try/catch belt) so re-running against an existing database is a
// no-op — nothing is ever dropped or rewritten.
function tableColumns(table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function addColumn(table: string, column: string, decl: string) {
  if (tableColumns(table).includes(column)) return;
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`); } catch { /* raced with another writer */ }
}

for (const [column, decl] of [
  ['model', 'TEXT'],
  ['project_id', 'TEXT'],
  ['parent_agent_id', 'TEXT'],
  ['role', 'TEXT'],
  ['summary', 'TEXT'],
  // Resume / steer support: everything needed to re-enter an agent's loop in
  // place after a crash, a rate limit, or a cooperative pause.
  ['messages', 'TEXT'],              // JSON transcript (compacted) of the task loop
  ['tool_calls', 'TEXT'],            // JSON log of {tool, at, preview}
  ['iterations', 'INTEGER'],         // cumulative loop iterations across runs
  ['last_error', 'TEXT'],            // why it stopped last time (e.g. provider 429)
  ['pending_instructions', 'TEXT'],  // JSON queue of undelivered interjections
  ['resume_count', 'INTEGER'],       // how many times it has been resumed
] as Array<[string, string]>) {
  addColumn('agents', column, decl);
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** JSON columns come back as strings; decode them defensively. */
function hydrateAgentRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    logs: parseJson<string[]>(row['logs'], []),
    messages: parseJson<unknown[]>(row['messages'], []),
    tool_calls: parseJson<unknown[]>(row['tool_calls'], []),
    pending_instructions: parseJson<string[]>(row['pending_instructions'], []),
  };
}

export const memory = {
  saveMessage(id: string, sessionId: string, role: string, content: string) {
    db.prepare(
      'INSERT OR REPLACE INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(id, sessionId, role, content, Date.now());
  },

  getMessages(sessionId: string, limit = 50): Array<{ role: string; content: string }> {
    return db
      .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(sessionId, limit) as Array<{ role: string; content: string }>;
  },

  getFullMessages(sessionId: string, limit = 100): Array<{ id: string; role: string; content: string; timestamp: number }> {
    // Get the most recent N messages (DESC), then re-sort ascending for display.
    const rows = db
      .prepare('SELECT id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(sessionId, limit) as Array<{ id: string; role: string; content: string; timestamp: number }>;
    return rows.reverse();
  },

  clearSession(sessionId: string) {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  },

  saveAgent(agent: {
    id: string;
    goal: string;
    status: string;
    startedAt: number;
    completedAt?: number;
    logs: string[];
    pid?: number;
    model?: string;
    projectId?: string;
    parentAgentId?: string;
    role?: string;
    summary?: string;
    /** Compacted task-loop transcript so the agent can be resumed in place. */
    messages?: unknown[];
    toolCalls?: unknown[];
    iterations?: number;
    lastError?: string;
    pendingInstructions?: string[];
    resumeCount?: number;
  }) {
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, goal, status, started_at, completed_at, logs, pid, model, project_id, parent_agent_id, role, summary,
                                     messages, tool_calls, iterations, last_error, pending_instructions, resume_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agent.id,
      agent.goal,
      agent.status,
      agent.startedAt,
      agent.completedAt ?? null,
      JSON.stringify(agent.logs),
      agent.pid ?? null,
      agent.model ?? null,
      agent.projectId ?? null,
      agent.parentAgentId ?? null,
      agent.role ?? null,
      agent.summary ?? null,
      agent.messages ? JSON.stringify(agent.messages) : null,
      agent.toolCalls ? JSON.stringify(agent.toolCalls) : null,
      agent.iterations ?? null,
      agent.lastError ?? null,
      agent.pendingInstructions ? JSON.stringify(agent.pendingInstructions) : null,
      agent.resumeCount ?? null
    );
  },

  getAgents(): Array<Record<string, unknown>> {
    const rows = db.prepare('SELECT * FROM agents ORDER BY started_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((r) => hydrateAgentRow(r));
  },

  getAgent(id: string): Record<string, unknown> | undefined {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? hydrateAgentRow(row) : undefined;
  },

  deleteAgent(id: string): boolean {
    const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return result.changes > 0;
  },

  clearAgentHistory(): number {
    const result = db.prepare('DELETE FROM agents WHERE status != ?').run('running');
    return result.changes;
  },

  saveTelemetry(source: string, event: string, data: Record<string, unknown>) {
    db.prepare('INSERT INTO telemetry (source, event, data, timestamp) VALUES (?, ?, ?, ?)').run(
      source,
      event,
      JSON.stringify(data),
      Date.now()
    );
  },

  getRecentTelemetry(limit = 100) {
    return db
      .prepare('SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
  },
};
