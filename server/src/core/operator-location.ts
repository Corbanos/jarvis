import { requestContext } from './request-context.js';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Precise operator location supplied by the browser Geolocation API. */
export interface OperatorLocation {
  lat: number;
  lon: number;
  accuracyM?: number;
  source: 'browser' | 'ip' | 'profile';
  updatedAt: number;
  city?: string;
  region?: string;
}

export interface PreciseLocationSummary {
  name: string;
  coordinates: string;
  accuracyM?: number;
  updatedAt: number;
}

type LocationInput = Omit<OperatorLocation, 'updatedAt'>;

export function parseBrowserLocation(value: unknown): LocationInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const lat = input['lat'];
  const lon = input['lon'];
  const accuracy = input['accuracyM'];
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return null;

  const cleanLabel = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string') return undefined;
    const trimmed = candidate.trim().slice(0, 120);
    return trimmed || undefined;
  };

  return {
    lat,
    lon,
    accuracyM: Math.round(accuracy),
    city: cleanLabel(input['city']),
    region: cleanLabel(input['region']),
    source: 'browser',
  };
}

export function summarizePreciseLocation(location: OperatorLocation | null): PreciseLocationSummary | null {
  if (!location || location.source !== 'browser') return null;
  const coordinates = `${location.lat.toFixed(6)},${location.lon.toFixed(6)}`;
  return {
    name: [location.city, location.region].filter(Boolean).join(', ') || coordinates,
    coordinates,
    accuracyM: location.accuracyM,
    updatedAt: location.updatedAt,
  };
}

function isStoredLocation(value: unknown): value is OperatorLocation {
  if (!value || typeof value !== 'object') return false;
  const loc = value as Partial<OperatorLocation>;
  return typeof loc.lat === 'number'
    && Number.isFinite(loc.lat)
    && loc.lat >= -90
    && loc.lat <= 90
    && typeof loc.lon === 'number'
    && Number.isFinite(loc.lon)
    && loc.lon >= -180
    && loc.lon <= 180
    && typeof loc.updatedAt === 'number'
    && Number.isFinite(loc.updatedAt)
    && (loc.source === 'browser' || loc.source === 'ip' || loc.source === 'profile');
}

export class OperatorLocationStore {
  private current: OperatorLocation | null;

  constructor(
    private readonly filePath = join(homedir(), '.jarvis', 'operator-location.json'),
    private readonly clock: () => number = Date.now,
  ) {
    this.current = this.load();
  }

  set(location: LocationInput): void {
    this.current = { ...location, updatedAt: this.clock() };
    if (location.source === 'browser') this.persist(this.current);
  }

  get(): OperatorLocation | null {
    return this.current ? { ...this.current } : null;
  }

  getFresh(maxAgeMs: number = 30 * 60_000): OperatorLocation | null {
    if (!this.current) return null;
    if (this.current.source === 'browser' && this.clock() - this.current.updatedAt > maxAgeMs) return null;
    return { ...this.current };
  }

  clear(): void {
    this.current = null;
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
    } catch { /* best-effort cleanup */ }
  }

  private load(): OperatorLocation | null {
    try {
      if (!existsSync(this.filePath)) return null;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      return isStoredLocation(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private persist(location: OperatorLocation): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(location), { encoding: 'utf8', mode: 0o600 });
    chmodSync(this.filePath, 0o600);
  }
}

// Browser fixes are ephemeral and keyed by requesting page/client. Never load the
// legacy operator-location.json: it has no device attribution.
const locations = new Map<string, OperatorLocation>();
const MAX_AGE = 30 * 60_000;
export function setOperatorLocation(loc: LocationInput, clientId = requestContext.getStore()?.clientId): void {
  if (!clientId) return;
  const now = Date.now();
  for (const [id, fix] of locations) if (now - fix.updatedAt > MAX_AGE) locations.delete(id);
  if (locations.size >= 1000) locations.delete(locations.keys().next().value!);
  locations.set(clientId, { ...loc, updatedAt: now });
}
export function getOperatorLocation(clientId = requestContext.getStore()?.clientId): OperatorLocation | null {
  const fix = clientId ? locations.get(clientId) : null;
  return fix ? { ...fix } : null;
}
export function clearOperatorLocation(clientId = requestContext.getStore()?.clientId): void {
  if (clientId) locations.delete(clientId);
}
export function getFreshLocation(maxAgeMs = MAX_AGE): OperatorLocation | null {
  const fix = getOperatorLocation();
  return fix && Date.now() - fix.updatedAt <= maxAgeMs ? fix : null;
}
