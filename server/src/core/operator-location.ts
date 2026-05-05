/**
 * Operator location store. The HUD pushes browser geolocation here; tools
 * (worldview.nearby, weather, etc.) read from here for "near me" queries.
 *
 * Falls through to IP-locate, then to OPERATOR.md default, if no precise
 * fix is available.
 */

interface OperatorLocation {
  lat: number;
  lon: number;
  accuracyM?: number;
  source: 'browser' | 'ip' | 'profile';
  updatedAt: number;
  city?: string;
  region?: string;
}

let _current: OperatorLocation | null = null;

export function setOperatorLocation(loc: Omit<OperatorLocation, 'updatedAt'>): void {
  _current = { ...loc, updatedAt: Date.now() };
}

export function getOperatorLocation(): OperatorLocation | null {
  return _current;
}

/**
 * Return precise browser fix if it's recent (default <30 min), else null.
 * Tools should fall back to ipLocate() / profile default if this returns null.
 */
export function getFreshLocation(maxAgeMs: number = 30 * 60_000): OperatorLocation | null {
  if (!_current) return null;
  if (_current.source === 'browser' && Date.now() - _current.updatedAt > maxAgeMs) return null;
  return _current;
}
