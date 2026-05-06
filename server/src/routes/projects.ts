import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, normalize, extname } from 'path';
import {
  createProject, getProject, listProjects, updateProject,
  signOffProject, resumeProject, deleteProject,
  addNote, listNotes,
  listLibraryApps, readManifest, writeManifest, appDir, LIBRARY_ROOT,
} from '../core/projects.js';
import { getActiveProjectId, setActiveProjectId, clearActiveProject } from '../core/active-project.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wav':  'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export async function projectsRoutes(app: FastifyInstance) {
  // ─── Projects CRUD ────────────────────────────────────────────────────
  app.get('/api/projects', async (request, reply) => {
    const q = request.query as { status?: string; kind?: string };
    return reply.send({
      projects: listProjects({
        status: q.status as 'active' | 'signed_off' | 'archived' | undefined,
        kind: q.kind as 'app' | 'research' | 'task' | undefined,
      }),
    });
  });

  app.post('/api/projects', async (request, reply) => {
    const body = request.body as { name?: string; description?: string; kind?: 'app'|'research'|'task' };
    if (!body.name || !body.name.trim()) return reply.status(400).send({ error: 'name required' });
    const p = createProject({ name: body.name.trim(), description: body.description, kind: body.kind ?? 'app' });
    return reply.send({ project: p });
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const p = getProject(id);
    if (!p) return reply.status(404).send({ error: 'not found' });
    return reply.send({ project: p, notes: listNotes(p.id, 200), manifest: p.kind === 'app' ? readManifest(p.slug) : null });
  });

  app.patch('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{ name: string; description: string; status: 'active'|'signed_off'|'archived'; summary: string; last_left_off: string }>;
    const p = updateProject(id, body);
    if (!p) return reply.status(404).send({ error: 'not found' });
    return reply.send({ project: p });
  });

  app.post('/api/projects/:id/sign-off', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { summary?: string };
    if (!body.summary) return reply.status(400).send({ error: 'summary required' });
    const p = signOffProject(id, body.summary);
    if (!p) return reply.status(404).send({ error: 'not found' });
    if (getActiveProjectId() === p.id) clearActiveProject();
    return reply.send({ project: p });
  });

  app.post('/api/projects/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const p = resumeProject(id);
    if (!p) return reply.status(404).send({ error: 'not found' });
    return reply.send({ project: p });
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = deleteProject(id);
    return reply.send({ ok });
  });

  app.post('/api/projects/:id/notes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: string; kind?: 'note'|'session'|'sign_off' };
    if (!body.content) return reply.status(400).send({ error: 'content required' });
    if (!getProject(id)) return reply.status(404).send({ error: 'not found' });
    return reply.send({ note: addNote(id, body.kind ?? 'note', body.content) });
  });

  // ─── Active project (chat context) ────────────────────────────────────
  app.get('/api/projects/active', async (_req, reply) => {
    const id = getActiveProjectId();
    if (!id) return reply.send({ active: null });
    const p = getProject(id);
    if (!p) { clearActiveProject(); return reply.send({ active: null }); }
    return reply.send({ active: p, notes: listNotes(p.id, 12), manifest: p.kind === 'app' ? readManifest(p.slug) : null });
  });

  app.post('/api/projects/:id/init', async (request, reply) => {
    const { id } = request.params as { id: string };
    const p = getProject(id);
    if (!p) return reply.status(404).send({ error: 'not found' });
    // INIT also flips the project back to active if it was signed off.
    if (p.status !== 'active') resumeProject(p.id);
    setActiveProjectId(p.id);
    return reply.send({ active: getProject(p.id) });
  });

  app.delete('/api/projects/active', async (_req, reply) => {
    clearActiveProject();
    return reply.send({ active: null });
  });

  // ─── Library: list + serve assets ─────────────────────────────────────
  app.get('/api/library', async (_req, reply) => {
    return reply.send({ apps: listLibraryApps() });
  });

  app.get('/api/library/:slug/manifest', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const m = readManifest(slug);
    if (!m) return reply.status(404).send({ error: 'not found' });
    return reply.send(m);
  });

  app.patch('/api/library/:slug/manifest', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as Record<string, unknown>;
    return reply.send(writeManifest(slug, body));
  });

  // Serve any file from the app's asset directory. Sandboxed: paths must
  // resolve inside LIBRARY_ROOT/<slug>/.
  app.get('/library/:slug/*', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const wildcard = (request.params as Record<string, string>)['*'] || '';
    const safePath = wildcard.replace(/\.\.+/g, '').replace(/^\/+/, '');
    const full = normalize(join(appDir(slug), safePath));
    if (!full.startsWith(LIBRARY_ROOT)) return reply.status(403).send('forbidden');
    if (!existsSync(full)) return reply.status(404).send('not found');
    const stat = statSync(full);
    if (stat.isDirectory()) return reply.status(403).send('directory listing forbidden');
    const ext = extname(full).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    reply.header('Content-Type', mime);
    reply.header('Cache-Control', 'no-cache');
    return reply.send(readFileSync(full));
  });

  // Convenience: /library/:slug/ → /library/:slug/index.html
  app.get('/library/:slug/', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const m = readManifest(slug);
    const entry = m?.entry ?? 'index.html';
    const full = join(appDir(slug), entry);
    if (!existsSync(full)) return reply.status(404).send('app not built yet');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(readFileSync(full));
  });
}
