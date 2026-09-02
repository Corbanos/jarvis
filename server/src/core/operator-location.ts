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

const store = new OperatorLocationStore();

export function setOperatorLocation(loc: LocationInput): void {
  store.set(loc);
}

export function getOperatorLocation(): OperatorLocation | null {
  return store.get();
}

export function clearOperatorLocation(): void {
  store.clear();
}

/**
 * Return precise browser fix if it's recent (default <30 min), else null.
 * Tools should fall back to ipLocate() / profile default if this returns null.
 */
export function getFreshLocation(maxAgeMs: number = 30 * 60_000): OperatorLocation | null {
  return store.getFresh(maxAgeMs);
}
