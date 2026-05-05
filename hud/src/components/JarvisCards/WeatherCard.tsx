'use client';

interface WeatherData {
  location: string;
  current: {
    temp: number;
    feels_like: number;
    humidity: number;
    condition: string;
    icon: string;
    wind_kmh: number;
    wind_dir: string;
    is_day: boolean;
    precipitation: number;
  };
  sunrise: string;
  sunset: string;
  forecast: Array<{
    date: string;
    day: string;
    high: number;
    low: number;
    condition: string;
    icon: string;
    rain_chance: number;
  }>;
}

const ICONS: Record<string, string> = {
  'sun': '☀',
  'moon': '☾',
  'cloud-sun': '⛅',
  'cloud-moon': '☁',
  'cloud-fog': '🌫',
  'cloud-drizzle': '🌦',
  'cloud-rain': '🌧',
  'cloud-snow': '❄',
  'cloud-lightning': '⛈',
  'cloud': '☁',
};

export function WeatherCard({ data }: { data: WeatherData }) {
  if (!data?.current) return null;

  const sunriseTime = new Date(data.sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const sunsetTime = new Date(data.sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(0,15,30,0.95) 0%, rgba(0,8,18,0.95) 100%)',
      border: '1px solid rgba(0,229,255,0.3)',
      borderRadius: 4,
      padding: '14px 16px',
      position: 'relative',
      overflow: 'hidden',
      maxWidth: '100%',
      boxShadow: '0 0 24px rgba(0,180,255,0.08), inset 0 0 30px rgba(0,180,255,0.02)',
    }}>
      {/* Corner brackets */}
      {(['tl','tr','bl','br'] as const).map((p) => <CornerBracket key={p} pos={p} />)}

      {/* Scan line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1, top: 0,
        background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.4), transparent)',
        animation: 'scanline 6s linear infinite', pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(0,229,255,0.1)' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)', boxShadow: '0 0 6px var(--accent-green)' }} />
        <span style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700 }}>
          ATMOSPHERIC CONDITIONS
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(0,229,255,0.15)' }} />
        <span style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
          {data.location.toUpperCase()}
        </span>
      </div>

      {/* Main display */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        {/* Big icon + temp */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 56, lineHeight: 1, marginBottom: 4,
            color: 'var(--accent-bright)',
            filter: 'drop-shadow(0 0 12px rgba(0,229,255,0.5))',
          }}>
            {ICONS[data.current.icon] ?? '☁'}
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent-bright)', lineHeight: 1, letterSpacing: '0.02em', textShadow: '0 0 16px rgba(0,229,255,0.4)' }}>
            {data.current.temp}°C
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', letterSpacing: '0.15em', marginTop: 2 }}>
            FEELS {data.current.feels_like}°
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Stat label="CONDITION" value={data.current.condition} />
          <Stat label="HUMIDITY" value={`${data.current.humidity}%`} />
          <Stat label="WIND" value={`${data.current.wind_kmh} ${data.current.wind_dir}`} unit="KM/H" />
          <Stat label="PRECIP" value={`${data.current.precipitation}`} unit="MM" />
          <Stat label="SUNRISE" value={sunriseTime} accent="amber" />
          <Stat label="SUNSET" value={sunsetTime} accent="amber" />
        </div>
      </div>

      {/* 5-day forecast */}
      <div style={{ borderTop: '1px solid rgba(0,229,255,0.1)', paddingTop: 10 }}>
        <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-dim)', marginBottom: 8 }}>
          5-DAY FORECAST
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {data.forecast.map((d, i) => (
            <ForecastDay key={i} day={d} isToday={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string | number; unit?: string; accent?: 'cyan' | 'amber' | 'green' }) {
  const color = accent === 'amber' ? 'var(--accent-amber)' : accent === 'green' ? 'var(--accent-green)' : 'var(--text-primary)';
  return (
    <div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.2em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: '0.04em' }}>
        {value}
        {unit && <span style={{ fontSize: 8, color: 'var(--text-dim)', marginLeft: 3, fontWeight: 400 }}>{unit}</span>}
      </div>
    </div>
  );
}

function ForecastDay({ day, isToday }: { day: WeatherData['forecast'][0]; isToday: boolean }) {
  return (
    <div style={{
      background: isToday ? 'rgba(0,229,255,0.08)' : 'rgba(0,12,24,0.6)',
      border: `1px solid ${isToday ? 'rgba(0,229,255,0.3)' : 'rgba(0,229,255,0.08)'}`,
      borderRadius: 3,
      padding: '6px 4px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 8, letterSpacing: '0.15em', color: isToday ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, marginBottom: 3 }}>
        {isToday ? 'TODAY' : day.day}
      </div>
      <div style={{ fontSize: 18, lineHeight: 1, marginBottom: 3 }}>
        {ICONS[day.icon] ?? '☁'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--accent-bright)', fontWeight: 700 }}>
        {day.high}°C
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>
        {day.low}°C
      </div>
      {day.rain_chance > 20 && (
        <div style={{ fontSize: 7, color: 'var(--accent-primary)', marginTop: 2, letterSpacing: '0.1em' }}>
          ◇ {day.rain_chance}%
        </div>
      )}
    </div>
  );
}

function CornerBracket({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 8;
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: size, height: size,
      borderTop: pos.includes('t') ? '2px solid var(--accent-primary)' : undefined,
      borderBottom: pos.includes('b') ? '2px solid var(--accent-primary)' : undefined,
      borderLeft: pos.includes('l') ? '2px solid var(--accent-primary)' : undefined,
      borderRight: pos.includes('r') ? '2px solid var(--accent-primary)' : undefined,
      zIndex: 2,
    }} />
  );
}
