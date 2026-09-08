import { getBuildId } from '@/lib/build-id';

// Under /build-id rather than /api so the front door sends it here, not to Fastify.
// (Not /_build: App Router treats underscore-prefixed folders as private.)
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ buildId: getBuildId() }, { headers: { 'Cache-Control': 'no-store' } });
}
