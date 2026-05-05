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

export const worldviewTool: ToolDefinition = {
  name: 'worldview',
  description: `Control the WORLDVIEW geospatial intelligence module — a 3D Cesium globe overlaid with live OSINT feeds.

Use this *liberally* whenever the operator asks anything that has a spatial answer:
- locations, places, "show me X", travel, geography
- live planes, military aircraft, satellites, ISS
- earthquakes, weather systems, wildfires
- traffic cameras / CCTV, ships, nuclear plants, military bases, air quality

Available actions:
  - { action: "open" }                              — show the globe panel
  - { action: "close" }                             — hide it
  - { action: "focus", location: "Tokyo" | "lat,lon" } — fly camera to a location (also opens the globe)
  - { action: "layer", name: "<layer>", enable: true|false } — toggle a single intel layer
  - { action: "layers", layers: { name: bool, ... } }     — toggle several at once
  - { action: "mode", mode: "normal"|"nvg"|"flir"|"crt" } — switch render mode

Layers (each toggles independently): ${KNOWN_LAYERS.join(', ')}.
Render modes: ${KNOWN_MODES.join(', ')} (CRT, night vision, FLIR / thermal, normal).

Tactically: when the operator asks "are there earthquakes today" → open + layer seismic on. Asking about flights overhead → open + layer flights on, focus their location. Asking about a city → focus + enable cctv + traffic. Stack layers as appropriate.`,
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['open', 'close', 'focus', 'layer', 'layers', 'mode'], description: 'Action to perform' },
      location: { type: 'string', description: 'Place name or "lat,lon" (for focus)' },
      name: { type: 'string', enum: [...KNOWN_LAYERS], description: 'Layer name (for layer action)' },
      enable: { type: 'boolean', description: 'true to turn on, false to turn off (for layer action)' },
      layers: { type: 'object', description: 'Map of { layerName: boolean } (for layers action)' },
      mode: { type: 'string', enum: [...KNOWN_MODES], description: 'Render mode (for mode action)' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;

    if (!_broadcast) return 'Worldview unavailable.';

    switch (action) {
      case 'open':
        _broadcast('worldview', { action: 'open' });
        return 'Worldview opened — globe displayed in HUD.';
      case 'close':
        _broadcast('worldview', { action: 'close' });
        return 'Worldview closed.';
      case 'focus': {
        const location = input['location'] as string | undefined;
        if (!location) return 'Error: location required for focus action.';
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
      case 'layer': {
        const name = input['name'] as string | undefined;
        const enable = input['enable'];
        if (!name) return 'Error: name required for layer action.';
        if (typeof enable !== 'boolean') return 'Error: enable (true|false) required for layer action.';
        if (!KNOWN_LAYERS.includes(name as typeof KNOWN_LAYERS[number])) {
          return `Unknown layer "${name}". Valid: ${KNOWN_LAYERS.join(', ')}.`;
        }
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
        if (!mode || !KNOWN_MODES.includes(mode as typeof KNOWN_MODES[number])) {
          return `Error: mode must be one of ${KNOWN_MODES.join(', ')}.`;
        }
        _broadcast('worldview', { action: 'mode', mode });
        return `Worldview render mode set to ${mode}.`;
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};
