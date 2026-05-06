/**
 * Live flight data via adsb.lol — free community ADS-B aggregator.
 *
 * Provides:
 *   - searchFlight(callsignOrIcao): find one specific aircraft globally
 *   - flightsNearLocation(lat, lon, radiusKm, limit)
 *   - flightsToward(destLat, destLon, withinKm): aircraft heading toward a target
 *   - registrationLookup(reg): look up an aircraft by tail number
 *
 * The adsb.lol API is per-region — we hit a small set of broad regions in
 * parallel, dedup by hex, and apply post-fetch filters.
 */

interface RawAircraft {
  hex: string;
  flight?: string;       // callsign (e.g. "AC1049")
  r?: string;            // registration (e.g. "C-FGKN")
  t?: string;            // aircraft type (e.g. "B789")
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;           // ground speed in knots
  track?: number;        // heading in degrees
  squawk?: string;
  desc?: string;         // free-text description
  category?: string;
}

export interface Flight {
  hex: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  lat: number;
  lon: number;
  altitudeM: number;
  altitudeFt: number;
  groundSpeedKmh: number;
  heading: number;
  squawk?: string;
  onGround: boolean;
}

const REGIONS = [
  { name: 'NA-east',     lat: 40.0,  lon: -74.0,  dist: 500 },
  { name: 'NA-west',     lat: 37.0,  lon: -122.0, dist: 500 },
  { name: 'NA-mid',      lat: 41.0,  lon: -95.0,  dist: 500 },
  { name: 'NA-north',    lat: 50.0,  lon: -100.0, dist: 600 },
  { name: 'EU-west',     lat: 48.8,  lon: 2.3,    dist: 500 },
  { name: 'EU-east',     lat: 52.0,  lon: 20.0,   dist: 500 },
  { name: 'UK',          lat: 51.5,  lon: -0.1,   dist: 400 },
  { name: 'ME',          lat: 25.0,  lon: 55.0,   dist: 500 },
  { name: 'EAsia',       lat: 35.0,  lon: 135.0,  dist: 500 },
  { name: 'SEAsia',      lat: 1.3,   lon: 104.0,  dist: 500 },
  { name: 'SAmerica',    lat: -23.0, lon: -46.0,  dist: 500 },
  { name: 'Oceania',     lat: -33.0, lon: 151.0,  dist: 500 },
  { name: 'SAsia',       lat: 28.0,  lon: 77.0,   dist: 500 },
];

function ftToM(ft: number): number { return ft * 0.3048; }
function knotsToKmh(kn: number): number { return kn * 1.852; }

function toFlight(a: RawAircraft): Flight | null {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const altFt = a.alt_baro === 'ground' ? 0 : (a.alt_baro || 0);
  return {
    hex: a.hex,
    callsign: (a.flight || a.hex).trim(),
    registration: (a.r || '').trim(),
    aircraftType: (a.t || '').trim(),
    lat: a.lat,
    lon: a.lon,
    altitudeFt: altFt,
    altitudeM: ftToM(altFt),
    groundSpeedKmh: a.gs ? knotsToKmh(a.gs) : 0,
    heading: a.track ?? 0,
    squawk: a.squawk,
    onGround: a.alt_baro === 'ground',
  };
}

let _cache: { flights: Flight[]; at: number } | null = null;
const CACHE_MS = 25_000; // adsb.lol updates ~every 30s

async function fetchAllFlights(): Promise<Flight[]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.flights;
  const proxy = ''; // server-side, no CORS proxy needed
  const results = await Promise.allSettled(REGIONS.map(async (r) => {
    const url = `https://api.adsb.lol/v2/lat/${r.lat}/lon/${r.lon}/dist/${r.dist}`;
    try {
      const res = await fetch(proxy + url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'jarvis-hud/1.0' } });
      if (!res.ok) return [];
      const j = await res.json() as { ac?: RawAircraft[] };
      return (j.ac || []);
    } catch { return []; }
  }));
  const seen = new Set<string>();
  const flights: Flight[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const raw of r.value) {
      if (seen.has(raw.hex)) continue;
      seen.add(raw.hex);
      const f = toFlight(raw);
      if (f) flights.push(f);
    }
  }
  _cache = { flights, at: Date.now() };
  return flights;
}

/**
 * Look up a single flight globally. Matches by callsign (e.g. "AC1049"),
 * registration (e.g. "C-FGKN"), or icao24 hex (e.g. "C063A1").
 */
export async function searchFlight(query: string): Promise<Flight[]> {
  const q = query.trim().toUpperCase().replace(/\s+/g, '');
  if (!q) return [];
  // adsb.lol has direct callsign endpoint that's fast.
  try {
    const r = await fetch(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'jarvis-hud/1.0' } });
    if (r.ok) {
      const j = await r.json() as { ac?: RawAircraft[] };
      const hits = (j.ac || []).map(toFlight).filter((x): x is Flight => !!x);
      if (hits.length) return hits;
    }
  } catch {}
  // Registration endpoint
  try {
    const r = await fetch(`https://api.adsb.lol/v2/reg/${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'jarvis-hud/1.0' } });
    if (r.ok) {
      const j = await r.json() as { ac?: RawAircraft[] };
      const hits = (j.ac || []).map(toFlight).filter((x): x is Flight => !!x);
      if (hits.length) return hits;
    }
  } catch {}
  // Icao24 hex endpoint
  try {
    const r = await fetch(`https://api.adsb.lol/v2/icao/${encodeURIComponent(q.toLowerCase())}`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'jarvis-hud/1.0' } });
    if (r.ok) {
      const j = await r.json() as { ac?: RawAircraft[] };
      const hits = (j.ac || []).map(toFlight).filter((x): x is Flight => !!x);
      if (hits.length) return hits;
    }
  } catch {}
  // Fallback: scan the full cached set.
  const all = await fetchAllFlights();
  return all.filter((f) =>
    f.callsign.toUpperCase() === q ||
    f.registration.toUpperCase() === q ||
    f.hex.toUpperCase() === q ||
    f.callsign.toUpperCase().startsWith(q) ||
    f.registration.toUpperCase() === q
  );
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Bearing from A to B in degrees (0=N, 90=E). */
function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => d * Math.PI / 180, toDeg = (r: number) => r * 180 / Math.PI;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export async function flightsNearLocation(lat: number, lon: number, radiusKm: number, limit: number = 30): Promise<Flight[]> {
  const all = await fetchAllFlights();
  return all
    .filter((f) => !f.onGround && haversineKm({ lat, lon }, f) <= radiusKm)
    .map((f) => ({ ...f, _dist: haversineKm({ lat, lon }, f) } as Flight & { _dist: number }))
    .sort((a, b) => (a as any)._dist - (b as any)._dist)
    .slice(0, limit);
}

/**
 * Aircraft currently heading toward a destination. We keep flights whose
 * current heading lines up (within `headingToleranceDeg`) with the bearing
 * to the destination AND that are in the air AND within `maxRangeKm` of
 * the destination (so we don't include planes on the wrong continent).
 */
export async function flightsToward(
  destLat: number, destLon: number,
  opts: { headingToleranceDeg?: number; maxRangeKm?: number; minRangeKm?: number; limit?: number } = {},
): Promise<(Flight & { distanceKm: number; bearingToDest: number; courseError: number })[]> {
  const tol = opts.headingToleranceDeg ?? 25;
  const maxKm = opts.maxRangeKm ?? 4000;
  const minKm = opts.minRangeKm ?? 30;     // ignore aircraft on the runway
  const limit = opts.limit ?? 25;
  const all = await fetchAllFlights();
  const dest = { lat: destLat, lon: destLon };
  const candidates = all
    .filter((f) => !f.onGround && f.groundSpeedKmh > 50 && f.altitudeM > 1000)
    .map((f) => {
      const distanceKm = haversineKm(f, dest);
      const bearingToDest = bearing(f, dest);
      const courseError = angularDiff(f.heading, bearingToDest);
      return { ...f, distanceKm, bearingToDest, courseError };
    })
    .filter((f) => f.distanceKm >= minKm && f.distanceKm <= maxKm && f.courseError <= tol)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
  return candidates;
}
