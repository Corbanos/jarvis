import type { ToolDefinition } from '../types/index.js';

let _broadcast: ((event: string, payload: Record<string, unknown>) => void) | null = null;

export function setWorldviewBroadcast(fn: (event: string, payload: Record<string, unknown>) => void) {
  _broadcast = fn;
}

const KNOWN_LAYERS = [
  'satellites', 'flights', 'military', 'traffic', 'cctv',
  'seismic', 'weather', 'wildfires', 'ships', 'nuclear',
  'bases', 'aqi', 'iss',
] as const;

const KNOWN_MODES = ['normal', 'nvg', 'flir', 'crt'] as const;

interface Pin {
  lat: number; lon: number; label: string;
  sub?: string; tag?: 'cyan' | 'amber' | 'green' | 'red';
}

// ─── Geocoding ────────────────────────────────────────────────────────────
async function geocode(query: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const q = query.trim();
  if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(q)) {
    const [lat, lon] = q.split(',').map(Number) as [number, number];
    return { lat, lon, name: q };
  }
  // Try Open-Meteo first (fast), fallback to Nominatim (more general).
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };
    const hit = j.results?.[0];
    if (hit) return { lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ') };
  } catch { /* fall through */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'jarvis-hud/1.0', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json() as Array<{ lat: string; lon: string; display_name: string }>;
    const hit = j[0];
    if (hit) return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), name: hit.display_name };
  } catch { /* */ }
  return null;
}

async function ipLocate(): Promise<{ lat: number; lon: number; name: string }> {
  const tries = [
    { url: 'https://ipwho.is/', pick: (j: any) => (j && j.success !== false && typeof j.latitude === 'number') ? { lat: j.latitude, lon: j.longitude, name: [j.city, j.region].filter(Boolean).join(', ') } : null },
    { url: 'https://ipapi.co/json/', pick: (j: any) => (j && typeof j.latitude === 'number') ? { lat: j.latitude, lon: j.longitude, name: [j.city, j.region].filter(Boolean).join(', ') } : null },
  ];
  for (const t of tries) {
    try {
      const r = await fetch(t.url, { signal: AbortSignal.timeout(3500) });
      if (!r.ok) continue;
      const got = t.pick(await r.json());
      if (got) return got;
    } catch { /* next */ }
  }
  // Final fallback: Toronto (operator's home).
  return { lat: 43.6532, lon: -79.3832, name: 'Toronto, ON' };
}

async function nearbySearch(lat: number, lon: number, query: string, radiusM: number, limit: number): Promise<Array<Pin & { dist: number }>> {
  const escaped = query.replace(/[^\w\s\-/&']/g, '').replace(/"/g, '\\"');
  const overpass = `[out:json][timeout:15];
(
  node["name"~"${escaped}",i](around:${radiusM},${lat},${lon});
  node["brand"~"${escaped}",i](around:${radiusM},${lat},${lon});
  node["amenity"~"${escaped}",i](around:${radiusM},${lat},${lon});
  node["shop"~"${escaped}",i](around:${radiusM},${lat},${lon});
);
out center ${limit * 2};`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(overpass),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return [];
    const j = await r.json() as { elements: Array<{ lat: number; lon: number; tags?: Record<string, string> }> };
    const ranked = (j.elements || []).map((el) => {
      const tags = el.tags || {};
      const name = tags['name'] || tags['brand'] || tags['amenity'] || tags['shop'] || 'Unnamed';
      const sub = [
        tags['addr:housenumber'] && tags['addr:street']
          ? `${tags['addr:housenumber']} ${tags['addr:street']}`
          : tags['addr:street'] || '',
        tags['addr:city'] || '',
      ].filter(Boolean).join(', ') || tags['opening_hours'] || '';
      return {
        lat: el.lat, lon: el.lon, label: name, sub,
        tag: 'amber' as const,
        dist: haversine({ lat, lon }, el),
      };
    }).sort((a, b) => a.dist - b.dist).slice(0, limit);
    return ranked;
  } catch { return []; }
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const worldviewTool: ToolDefinition = {
  name: 'worldview',
  description: `Control the WORLDVIEW geospatial intelligence module — a 3D Cesium globe with layered OSINT feeds AND a pin layer for arbitrary places.

USE THIS LIBERALLY. Any spatial question — "where is X", "nearest Y",
"show me on the map", planes, satellites, earthquakes, military, weather,
travel, locations, addresses — should pop the globe and either focus on
a place, drop pins, or toggle a layer. NEVER answer a spatial question
with plain text only.

Actions:
  - { action: "open" } — show the globe panel.
  - { action: "close" } — hide it.
  - { action: "focus", location: "Toronto" | "lat,lon", alt?, pitch? }
        — fly camera to a place. Use alt: 5000 for street-level,
          alt: 50000 for neighborhood, alt: 500000 for city, alt: 1500000 default.
  - { action: "layer", name: "<layer>", enable: true|false } — toggle one feed.
  - { action: "layers", layers: { name: bool, ... } } — bulk toggle.
  - { action: "mode", mode: "normal"|"nvg"|"flir"|"crt" } — render mode.
  - { action: "nearby", query: "<thing>", origin?: "address|lat,lon", radiusKm?, limit? }
        — POI search via Overpass/OSM. Drops pins on the globe and zooms
          to fit. If origin omitted, uses operator IP location (Toronto
          by default). Returns a numbered list with distances.
  - { action: "pins", pins: [{ lat, lon, label, sub?, tag? }], clear?, fit? }
        — drop arbitrary pins. tag: 'cyan' (default) | 'amber' | 'green' | 'red'.
  - { action: "clear-pins" } — wipe pin layer.

Layers: ${KNOWN_LAYERS.join(', ')}.
Render modes: ${KNOWN_MODES.join(', ')}.

Tactical examples:
  • "where is the nearest 7-Eleven" → action='nearby', query='7-Eleven'.
  • "are there earthquakes today" → action='open' + action='layer' name='seismic' enable=true.
  • "show me planes over Tokyo" → action='focus' location='Tokyo' + action='layer' name='flights' enable=true.
  • "fly me to the Eiffel Tower" → action='focus' location='Eiffel Tower' alt=2000.

After calling 'nearby' you receive a numbered list with distances. Use
that to write a short prose answer that REFERENCES the pins on screen
("Closest is the College Street one, 0.8 km southwest, sir.").`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['open', 'close', 'focus', 'layer', 'layers', 'mode', 'nearby', 'pins', 'clear-pins'] },
      location: { type: 'string', description: 'Place name or "lat,lon" (focus)' },
      alt: { type: 'number', description: 'Altitude in metres (focus). Lower = closer.' },
      pitch: { type: 'number', description: 'Camera pitch in degrees (focus). Default -55.' },
      name: { type: 'string', enum: [...KNOWN_LAYERS], description: 'Layer name (layer action)' },
      enable: { type: 'boolean' },
      layers: { type: 'object', description: 'Map of { layerName: boolean } (layers action)' },
      mode: { type: 'string', enum: [...KNOWN_MODES] },
      query: { type: 'string', description: 'POI search term (nearby action)' },
      origin: { type: 'string', description: 'Search origin: address or lat,lon. Omit to use operator IP location.' },
      radiusKm: { type: 'number', description: 'Search radius in km (default 5, max 25)' },
      limit: { type: 'number', description: 'Max results (default 8, max 25)' },
      pins: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lat: { type: 'number' }, lon: { type: 'number' },
            label: { type: 'string' }, sub: { type: 'string' },
            tag: { type: 'string', enum: ['cyan', 'amber', 'green', 'red'] },
          },
          required: ['lat', 'lon', 'label'],
        },
      },
      clear: { type: 'boolean' },
      fit: { type: 'boolean' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    if (!_broadcast) return 'Worldview unavailable.';

    switch (action) {
      case 'open':
        _broadcast('worldview', { action: 'open' });
        return 'Worldview opened.';
      case 'close':
        _broadcast('worldview', { action: 'close' });
        return 'Worldview closed.';
      case 'focus': {
        const location = input['location'] as string | undefined;
        if (!location) return 'Error: location required for focus.';
        const g = await geocode(location);
        if (!g) return `Could not geocode "${location}".`;
        _broadcast('worldview', {
          action: 'focus',
          lat: g.lat, lon: g.lon, name: g.name,
          alt: input['alt'], pitch: input['pitch'],
        });
        return `Worldview focused on ${g.name} (${g.lat.toFixed(3)}, ${g.lon.toFixed(3)}).`;
      }
      case 'layer': {
        const name = input['name'] as string | undefined;
        const enable = input['enable'];
        if (!name) return 'Error: name required for layer.';
        if (typeof enable !== 'boolean') return 'Error: enable required for layer.';
        if (!KNOWN_LAYERS.includes(name as typeof KNOWN_LAYERS[number])) return `Unknown layer "${name}". Valid: ${KNOWN_LAYERS.join(', ')}.`;
        _broadcast('worldview', { action: 'layer', name, enable });
        return `Layer ${name} ${enable ? 'enabled' : 'disabled'}.`;
      }
      case 'layers': {
        const layers = input['layers'] as Record<string, boolean> | undefined;
        if (!layers || typeof layers !== 'object') return 'Error: layers map required.';
        const valid: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(layers)) {
          if (KNOWN_LAYERS.includes(k as typeof KNOWN_LAYERS[number])) valid[k] = !!v;
        }
        _broadcast('worldview', { action: 'layers', layers: valid });
        return `Updated ${Object.keys(valid).length} layer(s): ${Object.entries(valid).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(', ')}.`;
      }
      case 'mode': {
        const mode = input['mode'] as string | undefined;
        if (!mode || !KNOWN_MODES.includes(mode as typeof KNOWN_MODES[number])) return `Error: mode must be one of ${KNOWN_MODES.join(', ')}.`;
        _broadcast('worldview', { action: 'mode', mode });
        return `Render mode: ${mode}.`;
      }
      case 'nearby': {
        const query = input['query'] as string | undefined;
        if (!query) return 'Error: query required.';
        let origin: { lat: number; lon: number; name: string };
        const originStr = input['origin'] as string | undefined;
        if (originStr) {
          const g = await geocode(originStr);
          if (!g) return `Could not geocode origin "${originStr}".`;
          origin = g;
        } else {
          origin = await ipLocate();
        }
        const radiusKm = Math.min(25, Math.max(0.5, (input['radiusKm'] as number | undefined) ?? 5));
        const limit = Math.min(25, Math.max(1, (input['limit'] as number | undefined) ?? 8));
        const pois = await nearbySearch(origin.lat, origin.lon, query, radiusKm * 1000, limit);
        if (!pois.length) return `No results for "${query}" within ${radiusKm}km of ${origin.name}.`;

        const allPins: Pin[] = [
          { lat: origin.lat, lon: origin.lon, label: 'You are here', sub: origin.name, tag: 'green' },
          ...pois.map((p) => ({ lat: p.lat, lon: p.lon, label: p.label, sub: p.sub, tag: p.tag })),
        ];
        _broadcast('worldview', { action: 'open' });
        _broadcast('worldview', { action: 'pins', clear: true, fit: true, pins: allPins });

        const summary = pois.map((p, i) => {
          const km = p.dist < 1000 ? `${p.dist.toFixed(0)} m` : `${(p.dist / 1000).toFixed(2)} km`;
          return `${i + 1}. ${p.label}${p.sub ? ` — ${p.sub}` : ''} (${km})`;
        }).join('\n');
        return `Nearby "${query}" from ${origin.name} — ${pois.length} result(s):\n${summary}`;
      }
      case 'pins': {
        const pins = input['pins'] as Pin[] | undefined;
        if (!pins?.length) return 'Error: pins array required.';
        _broadcast('worldview', { action: 'open' });
        _broadcast('worldview', {
          action: 'pins',
          clear: !!input['clear'],
          fit: input['fit'] !== false,
          pins,
        });
        return `Dropped ${pins.length} pin(s).`;
      }
      case 'clear-pins':
        _broadcast('worldview', { action: 'clear-pins' });
        return 'Pins cleared.';
      default:
        return `Unknown action: ${action}`;
    }
  },
};
