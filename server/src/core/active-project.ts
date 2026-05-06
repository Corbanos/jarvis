/**
 * Active project pointer.
 *
 * When set, Jarvis treats the conversation as work on that project: the
 * system prompt is augmented with project context, default file/note
 * targets become this project, and `sign_off` automatically clears the
 * pointer so subsequent chat is unfocused again.
 *
 * Persisted to ~/.jarvis/active-project.json so it survives server
 * restart (matching how chat history persists).
 */
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';

const DATA_DIR = join(homedir(), '.jarvis');
mkdirSync(DATA_DIR, { recursive: true });
const PERSIST_PATH = join(DATA_DIR, 'active-project.json');

let _activeId: string | null = null;
let _initialized = false;

function loadFromDisk(): void {
  if (_initialized) return;
  _initialized = true;
  if (!existsSync(PERSIST_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf8')) as { id?: string };
    if (raw && typeof raw.id === 'string') _activeId = raw.id;
  } catch { /* ignore */ }
}

function saveToDisk(): void {
  try {
    if (_activeId) writeFileSync(PERSIST_PATH, JSON.stringify({ id: _activeId, at: Date.now() }));
    else if (existsSync(PERSIST_PATH)) rmSync(PERSIST_PATH);
  } catch { /* ignore */ }
}

export function getActiveProjectId(): string | null {
  loadFromDisk();
  return _activeId;
}

export function setActiveProjectId(id: string | null): void {
  loadFromDisk();
  _activeId = id;
  saveToDisk();
}

export function clearActiveProject(): void {
  setActiveProjectId(null);
}
