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

// Migration: add model column if it doesn't exist
try {
  db.exec(`ALTER TABLE agents ADD COLUMN model TEXT`);
} catch {
  // Column already exists
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
  }) {
    db.prepare(
      `INSERT OR REPLACE INTO agents (id, goal, status, started_at, completed_at, logs, pid, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      agent.id,
      agent.goal,
      agent.status,
      agent.startedAt,
      agent.completedAt ?? null,
      JSON.stringify(agent.logs),
      agent.pid ?? null,
      agent.model ?? null
    );
  },

  getAgents(): Array<Record<string, unknown>> {
    const rows = db.prepare('SELECT * FROM agents ORDER BY started_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, logs: JSON.parse(r['logs'] as string) }));
  },

  getAgent(id: string): Record<string, unknown> | undefined {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (row) {
      row['logs'] = JSON.parse(row['logs'] as string);
    }
    return row;
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
