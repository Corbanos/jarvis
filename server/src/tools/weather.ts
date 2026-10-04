import type { ToolDefinition } from '../types/index.js';
import { getFreshLocation } from '../core/operator-location.js';

let _broadcastModule: ((event: string, payload: Record<string, unknown>) => void) | null = null;
export function setWeatherBroadcast(fn: (event: string, payload: Record<string, unknown>) => void) {
  _broadcastModule = fn;
}

/**
 * Weather tool — uses Open-Meteo (free, no API key)
 * Returns rich JSON the model can embed as a <jarvis-card type="weather">.
 * Also auto-opens a 'weather' workspace window with the data.
 */
export const weatherTool: ToolDefinition = {
  name: 'weather',
  description: `Get current weather and forecast for a location. Returns structured JSON with temperature, conditions, wind, humidity, and 5-day forecast.

After calling this tool, ALWAYS embed a card in your response using this exact format:
<jarvis-card type="weather">{...JSON from tool...}</jarvis-card>

Then add a brief spoken summary AFTER the card. Example:
<jarvis-card type="weather">{"location":"...","current":{...},"forecast":[...]}</jarvis-card>

It's currently 64 degrees and partly cloudy in San Francisco, sir. Pleasant evening ahead.`,
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name or "lat,lon". Omit (do NOT pass any value) to use the requesting device\'s fresh browser GPS; unavailable GPS requires an explicit city.' },
    },
  },
  async handler(input) {
    const loc = (input['location'] as string | undefined)?.trim();
    try {
      // Geocode the location → lat/lon
      let lat: number, lon: number, displayName: string;

      if (loc && /^-?\d+\.?\d*,-?\d+\.?\d*$/.test(loc)) {
        [lat, lon] = loc.split(',').map(Number) as [number, number];
        displayName = loc;
      } else if (loc) {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=en&format=json`);
        const geo = await geoRes.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country: string }> };
        if (!geo.results?.[0]) return `Location "${loc}" not found.`;
        const r = geo.results[0];
        lat = r.latitude; lon = r.longitude;
        displayName = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
      } else if ((function() { const f = getFreshLocation(); return f && f.source === 'browser'; })()) {
        const f = getFreshLocation()!;
        lat = f.lat; lon = f.lon;
        displayName = [f.city, f.region].filter(Boolean).join(', ') || `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`;
      } else {
        return 'Requesting device GPS is unavailable or stale. Specify a city for weather (or enable LOCATION on this device). No host-IP fallback was used.';
      }

      // Fetch weather
      const params = new URLSearchParams({
        latitude: String(lat), longitude: String(lon),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
        temperature_unit: 'celsius',
        wind_speed_unit: 'kmh',
        timezone: 'auto',
        forecast_days: '5',
      });
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      const w = await wRes.json() as {
        current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; is_day: number; precipitation: number };
        daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; sunrise: string[]; sunset: string[] };
      };

      const data = {
        location: displayName,
        coords: { lat, lon },
        current: {
          temp: Math.round(w.current.temperature_2m),
          feels_like: Math.round(w.current.apparent_temperature),
          humidity: w.current.relative_humidity_2m,
          condition: codeToCondition(w.current.weather_code),
          icon: codeToIcon(w.current.weather_code, w.current.is_day === 1),
          wind_kmh: Math.round(w.current.wind_speed_10m),
          wind_dir: degreesToCompass(w.current.wind_direction_10m),
          is_day: w.current.is_day === 1,
          precipitation: w.current.precipitation,
        },
        sunrise: w.daily.sunrise[0],
        sunset: w.daily.sunset[0],
        forecast: w.daily.time.slice(0, 5).map((t, i) => ({
          date: t,
          day: new Date(t).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
          high: Math.round(w.daily.temperature_2m_max[i] ?? 0),
          low: Math.round(w.daily.temperature_2m_min[i] ?? 0),
          condition: codeToCondition(w.daily.weather_code[i] ?? 0),
          icon: codeToIcon(w.daily.weather_code[i] ?? 0, true),
          rain_chance: w.daily.precipitation_probability_max[i] ?? 0,
        })),
      };

      // Auto-open a dedicated weather window in the HUD
      if (_broadcastModule) {
        _broadcastModule('module', { action: 'open', type: 'weather', data });
      }

      return JSON.stringify(data);
    } catch (err) {
      return `Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

function codeToCondition(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow Showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

function codeToIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code <= 3) return isDay ? 'cloud-sun' : 'cloud-moon';
  if (code <= 48) return 'cloud-fog';
  if (code <= 57) return 'cloud-drizzle';
  if (code <= 67) return 'cloud-rain';
  if (code <= 77) return 'cloud-snow';
  if (code <= 82) return 'cloud-rain';
  if (code <= 86) return 'cloud-snow';
  if (code <= 99) return 'cloud-lightning';
  return 'cloud';
}

function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16] ?? 'N';
}
