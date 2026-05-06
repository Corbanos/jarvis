/**
 * Projects + library tool.
 *
 * Lets Jarvis create / list / resume / sign off projects, write or update
 * the in-HUD app for a project, and launch any built app in the operator's
 * HUD via a workspace 'app' module.
 */
import type { ToolDefinition } from '../types/index.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join, normalize, dirname } from 'path';
import {
  createProject, getProject, listProjects, updateProject,
  signOffProject, resumeProject, deleteProject,
  addNote, listNotes,
  listLibraryApps, readManifest, writeManifest, appDir, LIBRARY_ROOT,
  type ProjectRow, type AppManifest,
} from '../core/projects.js';
import { getActiveProjectId, setActiveProjectId, clearActiveProject } from '../core/active-project.js';

let _broadcast: ((event: string, payload: Record<string, unknown>) => void) | null = null;
export function setProjectsBroadcast(fn: (event: string, payload: Record<string, unknown>) => void) {
  _broadcast = fn;
}

function fmtProject(p: ProjectRow, manifest?: AppManifest | null): string {
  const lines: string[] = [
    `[${p.status}] ${p.name}  (slug: ${p.slug}, kind: ${p.kind})`,
    `  id: ${p.id}`,
    `  created: ${new Date(p.created_at).toISOString()}`,
    `  last active: ${new Date(p.last_active_at).toISOString()}`,
  ];
  if (p.description) lines.push(`  description: ${p.description}`);
  if (p.last_left_off) lines.push(`  left off: ${p.last_left_off}`);
  if (p.summary) lines.push(`  summary: ${p.summary}`);
  if (manifest) lines.push(`  app: ${manifest.ready ? 'built' : 'not yet built'}, ${manifest.icon ?? '◆'} ${manifest.name}`);
  return lines.join('\n');
}

function resolveProject(input: Record<string, unknown>): ProjectRow | null {
  const id = (input['id'] as string | undefined) ?? (input['slug'] as string | undefined);
  if (id) return getProject(id) ?? null;
  const activeId = getActiveProjectId();
  if (activeId) return getProject(activeId) ?? null;
  return null;
}

function resolveSlug(input: Record<string, unknown>): string | null {
  const slug = (input['slug'] as string | undefined)?.trim();
  if (slug) return slug;
  const id = (input['id'] as string | undefined)?.trim();
  if (id) {
    const p = getProject(id);
    if (p) return p.slug;
  }
  const activeId = getActiveProjectId();
  if (activeId) {
    const p = getProject(activeId);
    if (p) return p.slug;
  }
  return null;
}

function safeJoin(slug: string, rel: string): string {
  const dir = appDir(slug);
  const full = normalize(join(dir, rel.replace(/^\/+/, '')));
  if (!full.startsWith(LIBRARY_ROOT)) throw new Error(`path traversal blocked: ${rel}`);
  return full;
}

export const projectsTool: ToolDefinition = {
  name: 'projects',
  description: `Manage long-running projects and the in-HUD app library.

A "project" is a unit of multi-session work — designing a thing, building
an in-HUD mini-app, writing a research piece. Each project has a status
(active / signed_off / archived), a session log (notes), and optionally
an associated PLAYABLE app that runs in an iframe inside the HUD's
'app' module — NOT an external website. So 'tetris' becomes a Tetris
module operator can launch, and Jarvis can call it as a tool.

USE THIS:
- Whenever the operator says "let's start a project", "make me X" (where
  X is a buildable app: game, calculator, drawing pad, simulator...),
  "what was I working on", "where did we leave off", "sign off on this".
- Whenever the operator asks to "play <thing>", "open <thing>", or
  "launch <thing>" — call action='launch' with the slug.

ACTIVE PROJECT (chat-context binding):
There is exactly ONE 'active' project at a time, set by the operator
clicking INIT in the Projects panel or by you calling action='init'.
While a project is active, the system prompt shows you that project's
state EVERY turn (name, description, last left off, recent notes,
manifest). Treat the conversation as work on that project. The tool
defaults note / set_left_off / write_file / etc. to the active project
when slug/id are omitted.

Lifecycle:
  • action='init', id|slug=...   → set active. The operator usually
    does this from the UI, but you can do it too if they say "let's
    work on Tetris".
  • work happens (notes, file edits, mid-task pointers, etc.) — let
    the active project default propagate; don't keep passing slug.
  • action='sign_off', summary='...' → ends the working session,
    writes the summary as a sign_off note, and AUTO-CLEARS the active
    pointer. The conversation is unfocused again. Use this whenever
    the operator says "sign off", "end session", "that's a wrap",
    "done for now", "call it".
  • action='end_init' → only if the operator wants to UN-init without
    signing off (rare; e.g. "I'm pausing this for a sec to ask
    something else"). Doesn't write a summary.
  • action='active' → tell the operator what's currently INITed.

Actions:
  - { action: "create", name, description?, kind?: 'app'|'research'|'task' }
        — create a project. For kind='app' (default), also creates an
          empty asset directory ~/.jarvis/library/<slug>/ with a stub
          index.html. After creating, you typically:
            1) describe what the app should do,
            2) call write_file to populate index.html / app.js / app.css,
            3) call action='complete_app' to mark manifest.ready=true.
        Returns the project id and slug.

  - { action: "list", status?: 'active'|'signed_off'|'archived', kind? }
        — list projects.

  - { action: "get", id }
        — full record + recent notes + manifest.

  - { action: "resume", id }
        — flip status back to active. Returns the project + last_left_off
          + last 5 notes so you can tell the operator where they left off.

  - { action: "sign_off", id, summary }
        — end-of-session: marks signed_off, stores the summary, adds it
          as a sign_off note. Tell the operator what was wrapped up.

  - { action: "note", id, content, kind?: 'note'|'session' }
        — append a session note (something done, decided, learned).
          Default kind='note'. Call this throughout a session so the
          NEXT resume has real context.

  - { action: "set_left_off", id, text }
        — short single-line "where we left off" pointer (set this when
          stepping away mid-task without signing off).

  - { action: "write_file", slug, path, content }
        — write a text file inside ~/.jarvis/library/<slug>/. Use for
          building the app's HTML/JS/CSS. Path is relative to the asset
          dir (e.g. 'index.html', 'app.js', 'styles.css').

  - { action: "read_file", slug, path }
        — read a text file from the asset dir.

  - { action: "list_files", slug }
        — list files in the asset dir.

  - { action: "delete_file", slug, path }
        — remove a file from the asset dir.

  - { action: "complete_app", slug, name?, description?, icon?, width?, height? }
        — mark the app's manifest ready. After this, the operator can
          launch it and the library module will show it. Set icon to a
          single emoji or short glyph like '◆', '🎮', '✎'.

  - { action: "launch", slug }
        — open the app in the HUD as a workspace module. Use this when
          the operator says "play tetris", "open my drawing pad", etc.
          (Equivalent to module action=open type=app:<slug>.)

  - { action: "library" }
        — list all built apps with their slug + name + icon. Use this
          when the operator asks "what apps do I have" or "what can you
          launch".

  - { action: "delete", id }
        — delete a project (and its asset dir if app). Be sure.

PROCESS for "make me a tetris game":
  1) projects.create name="Tetris" kind="app"
  2) Spawn an agent (or write directly with write_file) to populate
     index.html with a self-contained Tetris implementation. The HTML
     should style itself in the HUD palette (dark / cyan accents).
  3) projects.complete_app slug=tetris icon='🎮'
  4) projects.launch slug=tetris
  5) projects.note id=<id> content="Tetris built and launched."`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [
        'create', 'list', 'get', 'resume', 'sign_off', 'note', 'set_left_off',
        'write_file', 'read_file', 'list_files', 'delete_file',
        'complete_app', 'launch', 'library', 'delete',
        'init', 'end_init', 'active',
      ] },
      id: { type: 'string', description: 'Project id (from create/list/get).' },
      slug: { type: 'string', description: 'App slug (alternative key for app actions).' },
      name: { type: 'string' },
      description: { type: 'string' },
      kind: { type: 'string', enum: ['app','research','task'] },
      status: { type: 'string', enum: ['active','signed_off','archived'] },
      summary: { type: 'string' },
      content: { type: 'string' },
      text: { type: 'string', description: '(set_left_off) one-line note' },
      path: { type: 'string', description: 'Relative file path inside the asset dir.' },
      icon: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['action'],
  },

  async handler(input) {
    const action = input['action'] as string;
    try {
      switch (action) {
        case 'init': {
          const target = resolveProject(input);
          if (!target) return 'Error: id or slug required.';
          // INIT also flips the project back to active if it was signed off.
          if (target.status !== 'active') resumeProject(target.id);
          setActiveProjectId(target.id);
          _broadcast?.('projects', { action: 'active_changed', activeId: target.id, project: getProject(target.id) });
          return `INITed "${target.name}". Conversation is now in context to this project — notes, file edits, and "where did we leave off" all default to it. Say "sign off" when done.`;
        }
        case 'end_init':
        case 'deinit': {
          if (!getActiveProjectId()) return 'No project is currently INITed.';
          clearActiveProject();
          _broadcast?.('projects', { action: 'active_changed', activeId: null });
          return 'Active project context cleared (without signing off).';
        }
        case 'active': {
          const id = getActiveProjectId();
          if (!id) return 'No project currently INITed.';
          const p = getProject(id);
          if (!p) { clearActiveProject(); return 'No project currently INITed.'; }
          return `Currently INITed: "${p.name}" (slug=${p.slug}, status=${p.status}).`;
        }
        case 'create': {
          const name = (input['name'] as string | undefined)?.trim();
          if (!name) return 'Error: name required.';
          const p = createProject({ name, description: input['description'] as string | undefined, kind: (input['kind'] as ProjectRow['kind']) ?? 'app' });
          _broadcast?.('projects', { action: 'created', project: p });
          return `Created project:\n${fmtProject(p, p.kind === 'app' ? readManifest(p.slug) : null)}`;
        }
        case 'list': {
          const list = listProjects({ status: input['status'] as ProjectRow['status'], kind: input['kind'] as ProjectRow['kind'] });
          if (!list.length) return 'No projects yet.';
          return list.map((p) => `- [${p.status}] ${p.name} (slug=${p.slug}, id=${p.id.slice(0,8)})${p.last_left_off ? ` — left off: ${p.last_left_off}` : ''}`).join('\n');
        }
        case 'get': {
          const id = (input['id'] as string | undefined) ?? (input['slug'] as string | undefined);
          if (!id) return 'Error: id or slug required.';
          const p = getProject(id);
          if (!p) return `No project for "${id}".`;
          const notes = listNotes(p.id, 12);
          const manifest = p.kind === 'app' ? readManifest(p.slug) : null;
          const noteLines = notes.length
            ? '\nRecent notes:\n' + notes.map((n) => `  • [${n.kind} ${new Date(n.created_at).toISOString().slice(0,16).replace('T',' ')}] ${n.content}`).join('\n')
            : '\nNo notes yet.';
          return fmtProject(p, manifest) + noteLines;
        }
        case 'resume': {
          const target = resolveProject(input);
          if (!target) return 'Error: id required (no active project either).';
          const p = resumeProject(target.id);
          if (!p) return `Could not resume "${target.slug}".`;
          setActiveProjectId(p.id);
          _broadcast?.('projects', { action: 'active_changed', activeId: p.id, project: p });
          const notes = listNotes(p.id, 5);
          const manifest = p.kind === 'app' ? readManifest(p.slug) : null;
          _broadcast?.('projects', { action: 'updated', project: p });
          const recent = notes.length ? notes.map((n) => `  • ${n.content}`).join('\n') : '  (no prior notes)';
          return `Resumed "${p.name}".\n${p.last_left_off ? `Left off: ${p.last_left_off}\n` : ''}Last 5 notes:\n${recent}\n${manifest ? `\nApp: ${manifest.ready ? 'built and launchable' : 'not yet built'}` : ''}`;
        }
        case 'sign_off': {
          const target = resolveProject(input);
          const summary = (input['summary'] as string | undefined)?.trim();
          if (!target) return 'Error: id required (no active project either).';
          if (!summary) return 'Error: summary required.';
          const p = signOffProject(target.id, summary);
          // Sign-off ALWAYS clears the active pointer (whether this project was
          // active or not, signing it off ends its working session).
          if (getActiveProjectId() === target.id) {
            clearActiveProject();
            _broadcast?.('projects', { action: 'active_changed', activeId: null });
          }
          _broadcast?.('projects', { action: 'updated', project: p });
          return `Signed off "${p?.name}" with summary:\n${summary}\n\nActive project context cleared. Conversation is now unfocused again.`;
        }
        case 'note': {
          const target = resolveProject(input);
          const content = (input['content'] as string | undefined)?.trim();
          if (!target) return 'Error: no project (pass id/slug or INIT a project first).';
          if (!content) return 'Error: content required.';
          const n = addNote(target.id, (input['kind'] as 'note'|'session') ?? 'note', content);
          _broadcast?.('projects', { action: 'note_added', projectId: target.id });
          return `Note added to "${target.name}" (#${n.id}).`;
        }
        case 'set_left_off': {
          const target = resolveProject(input);
          const text = (input['text'] as string | undefined)?.trim() ?? (input['content'] as string | undefined)?.trim();
          if (!target) return 'Error: no project (pass id/slug or INIT a project first).';
          if (!text) return 'Error: text required.';
          const p = updateProject(target.id, { last_left_off: text });
          _broadcast?.('projects', { action: 'updated', project: p });
          return `Marker set on "${target.name}": "${text}"`;
        }
        case 'write_file': {
          const slug = resolveSlug(input);
          const path = (input['path'] as string | undefined)?.trim();
          const content = input['content'] as string | undefined;
          if (!slug) return 'Error: slug required (or INIT a project first).';
          if (!path) return 'Error: path required.';
          if (typeof content !== 'string') return 'Error: content (string) required.';
          if (!existsSync(appDir(slug))) mkdirSync(appDir(slug), { recursive: true });
          const full = safeJoin(slug, path);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content);
          _broadcast?.('projects', { action: 'app_changed', slug });
          return `Wrote ${path} (${content.length} bytes) to ${slug}/.`;
        }
        case 'read_file': {
          const slug = resolveSlug(input);
          const path = (input['path'] as string | undefined)?.trim();
          if (!slug || !path) return 'Error: slug and path required (or INIT a project first).';
          const full = safeJoin(slug, path);
          if (!existsSync(full)) return `File not found: ${slug}/${path}`;
          return readFileSync(full, 'utf8');
        }
        case 'list_files': {
          const slug = resolveSlug(input);
          if (!slug) return 'Error: slug required (or INIT a project first).';
          const dir = appDir(slug);
          if (!existsSync(dir)) return 'No such app.';
          // Walk shallow — surface 1-deep entries.
          const out: string[] = [];
          for (const entry of readdirSync(dir)) {
            const s = statSync(join(dir, entry));
            out.push(`${entry}${s.isDirectory() ? '/' : ''} (${s.size} B)`);
          }
          return out.join('\n') || '(empty)';
        }
        case 'delete_file': {
          const slug = resolveSlug(input);
          const path = (input['path'] as string | undefined)?.trim();
          if (!slug || !path) return 'Error: slug and path required (or INIT a project first).';
          const full = safeJoin(slug, path);
          if (!existsSync(full)) return `File not found: ${slug}/${path}`;
          rmSync(full);
          _broadcast?.('projects', { action: 'app_changed', slug });
          return `Deleted ${slug}/${path}.`;
        }
        case 'complete_app': {
          const slug = resolveSlug(input);
          if (!slug) return 'Error: slug required (or INIT a project first).';
          const m = writeManifest(slug, {
            ready: true,
            name: input['name'] as string | undefined ?? readManifest(slug)?.name ?? slug,
            description: input['description'] as string | undefined,
            icon: input['icon'] as string | undefined ?? '◆',
            width: input['width'] as number | undefined,
            height: input['height'] as number | undefined,
          });
          _broadcast?.('projects', { action: 'app_ready', slug, manifest: m });
          return `App "${m.name}" marked ready. Operator can launch via 'projects launch slug=${slug}' or by clicking it in LIBRARY.`;
        }
        case 'launch': {
          const slug = resolveSlug(input);
          if (!slug) return 'Error: slug required (or INIT a project first).';
          const m = readManifest(slug);
          if (!m) return `No such app: ${slug}.`;
          if (!m.ready) return `App "${slug}" exists but isn't built yet — call complete_app first.`;
          // Open a workspace module of type 'app' with the slug payload.
          _broadcast?.('module', { action: 'open', type: 'app', data: { slug, manifest: m } });
          return `Launched "${m.name}" in the HUD.`;
        }
        case 'library': {
          const apps = listLibraryApps();
          if (!apps.length) return 'No apps in library yet.';
          return apps.map((a) => `${a.icon ?? '◆'}  ${a.name}  (slug=${a.slug})${a.ready ? '' : ' [not built]'}${a.description ? ' — ' + a.description : ''}`).join('\n');
        }
        case 'delete': {
          const id = (input['id'] as string | undefined) ?? (input['slug'] as string | undefined);
          if (!id) return 'Error: id required.';
          const target = getProject(id);
          if (!target) return `No project for "${id}".`;
          const ok = deleteProject(target.id);
          _broadcast?.('projects', { action: 'deleted', id: target.id, slug: target.slug });
          return ok ? `Deleted project "${target.name}".` : 'Delete failed.';
        }
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
