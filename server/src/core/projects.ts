/**
 * Projects + in-HUD app library.
 *
 * A "project" is a unit of multi-session work Eli does with Jarvis. Each
 * project has a status (active / signed-off / archived), a running session
 * log (what was worked on, decisions, blockers), and optionally an
 * associated *in-HUD app* — a self-contained iframe-served mini-app that
 * lives at ~/.jarvis/library/<slug>/ (index.html + manifest.json + assets).
 *
 * The same DB row covers both pure-research projects ("design Aegis") and
 * playable apps ("tetris game") — `kind` distinguishes them.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';

const DATA_DIR = join(homedir(), '.jarvis');
const LIBRARY_DIR = join(DATA_DIR, 'library');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(LIBRARY_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'jarvis.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    kind            TEXT NOT NULL DEFAULT 'app',   -- 'app' | 'research' | 'task'
    status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'signed_off' | 'archived'
    created_at      INTEGER NOT NULL,
    last_active_at  INTEGER NOT NULL,
    signed_off_at   INTEGER,
    summary         TEXT,                           -- end-of-session summary
    last_left_off   TEXT                            -- short "where we left off" sentence
  );

  CREATE TABLE IF NOT EXISTS project_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'note', -- 'note' | 'session' | 'sign_off'
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes(project_id, created_at);
`);

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description?: string;
  kind: 'app' | 'research' | 'task';
  status: 'active' | 'signed_off' | 'archived';
  created_at: number;
  last_active_at: number;
  signed_off_at?: number;
  summary?: string;
  last_left_off?: string;
}

export interface ProjectNote {
  id: number;
  project_id: string;
  kind: 'note' | 'session' | 'sign_off';
  content: string;
  created_at: number;
}

export interface AppManifest {
  slug: string;
  name: string;
  description?: string;
  icon?: string;            // single emoji or short glyph
  width?: number;           // preferred module width
  height?: number;          // preferred module height
  entry?: string;           // entry filename (default index.html)
  ready?: boolean;          // set true once an agent finishes building it
  createdAt?: number;
  updatedAt?: number;
}

// ─── Slugs ──────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project';
}

function uniqueSlug(base: string): string {
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
    if (n > 999) throw new Error('Could not find unique slug');
  }
  return slug;
}

// ─── CRUD ───────────────────────────────────────────────────────────────
import { v4 as uuid } from 'uuid';

export function createProject(input: { name: string; description?: string; kind?: ProjectRow['kind'] }): ProjectRow {
  const id = uuid();
  const slug = uniqueSlug(slugify(input.name));
  const now = Date.now();
  const kind = input.kind ?? 'app';
  db.prepare(
    `INSERT INTO projects (id, slug, name, description, kind, status, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, slug, input.name, input.description ?? null, kind, now, now);

  // Create asset dir for app projects
  if (kind === 'app') {
    const dir = join(LIBRARY_DIR, slug);
    mkdirSync(dir, { recursive: true });
    const manifest: AppManifest = {
      slug, name: input.name,
      description: input.description,
      icon: '◆',
      ready: false,
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    // Stub a placeholder index.html so the iframe doesn't 404 if launched early.
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"/><title>${input.name}</title>
<style>body{margin:0;background:#000;color:#00e5ff;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;letter-spacing:.15em;font-size:11px;}</style>
</head><body><div>● BUILDING ${input.name.toUpperCase()}<br/><br/><span style="color:#888;font-size:9px">Jarvis is constructing this app — refresh in a moment.</span></div></body></html>`);
  }

  return getProject(id)!;
}

export function getProject(idOrSlug: string): ProjectRow | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as ProjectRow | undefined;
  return row;
}

export function listProjects(opts: { status?: ProjectRow['status']; kind?: ProjectRow['kind']; limit?: number } = {}): ProjectRow[] {
  let where = '1=1', args: (string | number)[] = [];
  if (opts.status) { where += ' AND status = ?'; args.push(opts.status); }
  if (opts.kind)   { where += ' AND kind = ?';   args.push(opts.kind); }
  const limit = opts.limit ?? 100;
  return db.prepare(`SELECT * FROM projects WHERE ${where} ORDER BY last_active_at DESC LIMIT ?`).all(...args, limit) as ProjectRow[];
}

export function updateProject(id: string, patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status' | 'summary' | 'last_left_off'>>): ProjectRow | undefined {
  const cur = getProject(id);
  if (!cur) return undefined;
  const merged = { ...cur, ...patch, last_active_at: Date.now() };
  db.prepare(
    `UPDATE projects SET name=?, description=?, status=?, summary=?, last_left_off=?, last_active_at=?, signed_off_at=?
     WHERE id=?`
  ).run(
    merged.name, merged.description ?? null, merged.status,
    merged.summary ?? null, merged.last_left_off ?? null,
    merged.last_active_at,
    merged.status === 'signed_off' ? (cur.signed_off_at ?? Date.now()) : null,
    id
  );
  return getProject(id);
}

export function signOffProject(id: string, summary: string): ProjectRow | undefined {
  const cur = getProject(id);
  if (!cur) return undefined;
  const now = Date.now();
  db.prepare(
    `UPDATE projects SET status='signed_off', summary=?, signed_off_at=?, last_active_at=? WHERE id=?`
  ).run(summary, now, now, id);
  addNote(id, 'sign_off', summary);
  return getProject(id);
}

export function resumeProject(id: string): ProjectRow | undefined {
  const cur = getProject(id);
  if (!cur) return undefined;
  db.prepare(
    `UPDATE projects SET status='active', signed_off_at=NULL, last_active_at=? WHERE id=?`
  ).run(Date.now(), id);
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const cur = getProject(id);
  if (!cur) return false;
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  // Wipe asset dir if app
  if (cur.kind === 'app') {
    const dir = join(LIBRARY_DIR, cur.slug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  return true;
}

// ─── Notes ──────────────────────────────────────────────────────────────
export function addNote(projectId: string, kind: ProjectNote['kind'], content: string): ProjectNote {
  const at = Date.now();
  const r = db.prepare(`INSERT INTO project_notes (project_id, kind, content, created_at) VALUES (?, ?, ?, ?)`).run(projectId, kind, content, at);
  db.prepare(`UPDATE projects SET last_active_at = ? WHERE id = ?`).run(at, projectId);
  return { id: r.lastInsertRowid as number, project_id: projectId, kind, content, created_at: at };
}

export function listNotes(projectId: string, limit: number = 100): ProjectNote[] {
  return db.prepare(`SELECT * FROM project_notes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`).all(projectId, limit) as ProjectNote[];
}

// ─── App library helpers ────────────────────────────────────────────────
export function appDir(slug: string): string { return join(LIBRARY_DIR, slug); }

export function readManifest(slug: string): AppManifest | null {
  const p = join(appDir(slug), 'manifest.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as AppManifest; } catch { return null; }
}

export function writeManifest(slug: string, m: Partial<AppManifest>): AppManifest {
  const dir = appDir(slug);
  mkdirSync(dir, { recursive: true });
  const cur = readManifest(slug) ?? { slug, name: slug };
  const merged: AppManifest = { ...cur, ...m, slug, updatedAt: Date.now() };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(merged, null, 2));
  return merged;
}

export function listLibraryApps(): AppManifest[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  const out: AppManifest[] = [];
  for (const slug of readdirSync(LIBRARY_DIR)) {
    const m = readManifest(slug);
    if (m) out.push(m);
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export const LIBRARY_ROOT = LIBRARY_DIR;
