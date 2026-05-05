'use client';
import { useJarvisStore } from '@/lib/store';
import { type ModuleInstance } from '@/lib/workspace';
import { WeatherCard } from '@/components/JarvisCards/WeatherCard';

type WeatherData = Parameters<typeof WeatherCard>[0]['data'];

export function WeatherModule({ module }: { module: ModuleInstance }) {
  const fromModule = module.data as WeatherData | undefined;

  // Fallback: find latest weather card in chat history
  const messages = useJarvisStore((s) => s.messages);
  const fallback = !fromModule ? findLatestWeather(messages) : null;
  const data = fromModule ?? fallback;

  if (!data) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>☼</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>NO WEATHER DATA</div>
        <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7, padding: '0 16px', lineHeight: 1.5 }}>
          Ask Jarvis about the weather.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 8, height: '100%', overflow: 'auto' }}>
      <WeatherCard data={data} />
    </div>
  );
}

function findLatestWeather(messages: Array<{ text: string; timestamp: number }>): WeatherData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const match = m.text.match(/<jarvis-card type="weather">([\s\S]*?)<\/jarvis-card>/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]) as WeatherData;
      } catch { /* keep looking */ }
    }
  }
  return null;
}
