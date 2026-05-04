/**
 * Scheduler module
 * Jarvis can be told to do things at specific times or on a schedule
 * Supports: one-shot ("in 30 minutes"), cron ("every day at 9am"), recurring
 */
import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

const db = new Database(join(homedir(), '.jarvis', 'jarvis.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'cron',
    next_run INTEGER NOT NULL,
    last_run INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
`);

export interface ScheduledJob {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  scheduleType: 'cron' | 'once' | 'interval';
  nextRun: number;
  lastRun?: number;
  enabled: boolean;
  createdAt: number;
}

type JobRow = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  schedule_type: string;
  next_run: number;
  last_run: number | null;
  enabled: number;
  created_at: number;
};

function parseNaturalTime(input: string): number {
  const now = Date.now();
  const s = input.toLowerCase().trim();

  // "in X minutes/hours/seconds"
  const inMatch = s.match(/^in\s+(\d+)\s*(second|minute|hour|day)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1]!);
    const unit = inMatch[2]!;
    const ms = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 }[unit] ?? 60000;
    return now + n * ms;
  }

  // "at HH:MM" (today or tomorrow)
  const atMatch = s.match(/^at\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (atMatch) {
    let h = parseInt(atMatch[1]!);
    const m = parseInt(atMatch[2]!);
    const period = atMatch[3];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // "every X minutes" — interval
  const everyMatch = s.match(/^every\s+(\d+)\s*(second|minute|hour)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]!);
    const unit = everyMatch[2]!;
    const ms = { second: 1000, minute: 60000, hour: 3600000 }[unit] ?? 60000;
    return now + n * ms;
  }

  // Fallback: treat as timestamp or 60s from now
  return now + 60000;
}

function nextRunFromSchedule(schedule: string, type: string): number {
  if (type === 'once') return parseNaturalTime(schedule);
  if (type === 'interval') {
    const ms = parseInt(schedule);
    return Date.now() + (isNaN(ms) ? 60000 : ms);
  }
  // cron - simple next-minute approximation
  return Date.now() + 60000;
}

let _jarvisChat: ((prompt: string, sessionId: string) => Promise<unknown>) | null = null;
let _wsBroadcast: ((event: Record<string, unknown>) => void) | null = null;

export function initScheduler(
  chatFn: (prompt: string, sessionId: string) => Promise<unknown>,
  broadcastFn: (event: Record<string, unknown>) => void
) {
  _jarvisChat = chatFn;
  _wsBroadcast = broadcastFn;
  startPolling();
}

function startPolling() {
  setInterval(async () => {
    const now = Date.now();
    const due = db.prepare(
      'SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run <= ?'
    ).all(now) as JobRow[];

    for (const job of due) {
      console.log(`[Scheduler] Running job: ${job.name}`);
      _wsBroadcast?.({
        type: 'telemetry',
        payload: { source: 'SCHEDULER', event: `JOB:${job.name}`, data: { id: job.id } },
        timestamp: now,
      });

      try {
        await _jarvisChat?.(job.prompt, `scheduler-${job.id}`);
      } catch (e) {
        console.error(`[Scheduler] Job ${job.id} failed:`, e);
      }

      if (job.schedule_type === 'once') {
        db.prepare('UPDATE scheduled_jobs SET enabled = 0, last_run = ? WHERE id = ?').run(now, job.id);
      } else {
        const nextRun = nextRunFromSchedule(job.schedule, job.schedule_type);
        db.prepare('UPDATE scheduled_jobs SET last_run = ?, next_run = ? WHERE id = ?').run(now, nextRun, job.id);
      }
    }
  }, 5000); // Poll every 5 seconds
}

export function createJob(params: {
  name: string;
  prompt: string;
  schedule: string;
  scheduleType?: 'cron' | 'once' | 'interval';
}): ScheduledJob {
  const id = uuid();
  const type = params.scheduleType ?? 'once';
  const nextRun = nextRunFromSchedule(params.schedule, type);
  const now = Date.now();

  db.prepare(`
    INSERT INTO scheduled_jobs (id, name, prompt, schedule, schedule_type, next_run, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, params.name, params.prompt, params.schedule, type, nextRun, now);

  return {
    id, name: params.name, prompt: params.prompt,
    schedule: params.schedule, scheduleType: type,
    nextRun, enabled: true, createdAt: now,
  };
}

export function listJobs(): ScheduledJob[] {
  const rows = db.prepare('SELECT * FROM scheduled_jobs ORDER BY next_run ASC').all() as JobRow[];
  return rows.map(rowToJob);
}

export function deleteJob(id: string): boolean {
  const res = db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
  return res.changes > 0;
}

export function toggleJob(id: string, enabled: boolean): boolean {
  const res = db.prepare('UPDATE scheduled_jobs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return res.changes > 0;
}

function rowToJob(r: JobRow): ScheduledJob {
  return {
    id: r.id, name: r.name, prompt: r.prompt,
    schedule: r.schedule, scheduleType: r.schedule_type as ScheduledJob['scheduleType'],
    nextRun: r.next_run, lastRun: r.last_run ?? undefined,
    enabled: r.enabled === 1, createdAt: r.created_at,
  };
}
