import { getBuildId } from '@/lib/build-id';

// Under /build-id rather than /api so the front door sends it here, not to Fastify.
// (Not /_build: App Router treats underscore-prefixed folders as private.)
export const dynamic = 'force-dynamic';

// Inlined at build time, so this is the id of the build currently serving —
// the same constant the client bundle carries. The file read is a fallback.
const SERVING = process.env['NEXT_PUBLIC_BUILD_ID'] ?? '';

export function GET() {
  return Response.json({ buildId: SERVING || getBuildId() }, { headers: { 'Cache-Control': 'no-store' } });
}
