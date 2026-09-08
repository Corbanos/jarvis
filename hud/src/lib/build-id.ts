import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The id Next stamps on each production build. Read at build/render time on
 * the server; a page therefore carries the id of the build that produced it,
 * and can notice when the server has moved on to a newer one.
 */
export function getBuildId(): string {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}
