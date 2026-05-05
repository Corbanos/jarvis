import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'fs';
import { listCadJobs, getCadDir } from '../modules/openscad.js';

export async function cadRoutes(app: FastifyInstance) {
  // Serve PNG preview
  app.get('/api/cad/preview', async (req, reply) => {
    const q = req.query as { path?: string };
    const path = q.path;
    if (!path || !path.startsWith(getCadDir()) || !path.endsWith('.png') || !existsSync(path)) {
      return reply.status(404).send({ error: 'preview not found' });
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(readFileSync(path));
  });

  // Download STL or SCAD file
  app.get('/api/cad/file', async (req, reply) => {
    const q = req.query as { path?: string };
    const path = q.path;
    if (!path || !path.startsWith(getCadDir()) || !existsSync(path)) {
      return reply.status(404).send({ error: 'file not found' });
    }
    const isStl = path.endsWith('.stl');
    reply.header('Content-Type', isStl ? 'application/sla' : 'text/plain');
    reply.header('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`);
    reply.header('Content-Length', String(statSync(path).size));
    return reply.send(readFileSync(path));
  });

  // List recent CAD jobs
  app.get('/api/cad/list', async (_req, reply) => {
    const jobs = listCadJobs();
    return reply.send(jobs.map((j) => ({
      name: j.name,
      mtime: j.mtime,
      previewUrl: j.png ? `/api/cad/preview?path=${encodeURIComponent(j.png)}` : null,
      stlUrl: j.stl ? `/api/cad/file?path=${encodeURIComponent(j.stl)}` : null,
      scadUrl: j.scad ? `/api/cad/file?path=${encodeURIComponent(j.scad)}` : null,
    })));
  });
}
