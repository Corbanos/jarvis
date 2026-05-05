import type { ToolDefinition } from '../types/index.js';

let _broadcast: ((event: string, payload: Record<string, unknown>) => void) | null = null;

export function setWorldviewBroadcast(fn: (event: string, payload: Record<string, unknown>) => void) {
  _broadcast = fn;
}

export const worldviewTool: ToolDefinition = {
  name: 'worldview',
  description: `Open the WORLDVIEW geospatial intelligence module — a 3D globe with traffic cameras, satellites, OSINT layers.
Use this when the operator asks about:
- Locations, places, "show me X on the map"
- Traffic / road conditions / cameras in any city
- Satellites overhead, ISS tracking
- Geographic intelligence, news location overlays

Actions:
- open: Show the worldview overlay
- close: Hide it
- focus: Fly the camera to a location (lat,lon or place name)`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['open', 'close', 'focus'], description: 'Action to perform' },
      location: { type: 'string', description: 'Place name or "lat,lon" (for focus action)' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    const location = input['location'] as string | undefined;

    if (!_broadcast) return 'Worldview unavailable.';

    switch (action) {
      case 'open':
        _broadcast('worldview', { action: 'open' });
        return 'Worldview opened — globe displayed in HUD.';
      case 'close':
        _broadcast('worldview', { action: 'close' });
        return 'Worldview closed.';
      case 'focus': {
        if (!location) return 'Error: location required for focus action.';
        // Try to resolve via Open-Meteo geocoder if not lat,lon
        let lat: number | null = null, lon: number | null = null, name = location;
        if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(location.trim())) {
          [lat, lon] = location.trim().split(',').map(Number) as [number, number];
        } else {
          try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
            const data = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };
            const r = data.results?.[0];
            if (r) {
              lat = r.latitude; lon = r.longitude;
              name = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
            }
          } catch { /* fall through */ }
        }
        if (lat === null || lon === null) return `Could not geocode "${location}".`;
        _broadcast('worldview', { action: 'focus', lat, lon, name });
        return `Worldview focused on ${name} (${lat.toFixed(3)}, ${lon.toFixed(3)}).`;
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};
