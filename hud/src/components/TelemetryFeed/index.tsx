'use client';
import { useRef, useEffect } from 'react';
import { useJarvisStore, type TelemetryRecord } from '@/lib/store';

export function TelemetryFeed() {
  const telemetry = useJarvisStore((s) => s.telemetry);
  const toolCalls = useJarvisStore((s) => s.toolCalls);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [telemetry, toolCalls]);

  // Merge telemetry + tool calls into a unified feed
  const feed = [
    ...telemetry.map((t) => ({ ...t, feedType: 'telemetry' as const })),
    ...toolCalls.map((t) => ({
      source: 'JARVIS',
      event: `TOOL:${t.name}`,
      data: { status: t.status },
      timestamp: t.timestamp,
      feedType: 'tool' as const,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp).slice(-50);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {feed.length === 0 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.15em', textAlign: 'center', marginTop: 20 }}>
          AWAITING TELEMETRY
        </div>
      )}
      {feed.map((item, i) => (
        <FeedRow key={i} item={item} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function FeedRow({ item }: { item: { source: string; event: string; data: Record<string, unknown>; timestamp: number; feedType: 'telemetry' | 'tool' } }) {
  const time = new Date(item.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const color = item.feedType === 'tool' ? 'var(--accent-amber)' : 'var(--accent-primary)';

  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 9, lineHeight: 1.5, animation: 'slide-in-right 0.15s ease' }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0, letterSpacing: '0.05em' }}>{time}</span>
      <span style={{ color, flexShrink: 0, letterSpacing: '0.1em' }}>[{item.source}]</span>
      <span style={{ color: 'var(--text-secondary)', letterSpacing: '0.05em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.event}
        {Object.keys(item.data).length > 0 && (
          <span style={{ color: 'var(--text-dim)' }}> {JSON.stringify(item.data).slice(0, 60)}</span>
        )}
      </span>
    </div>
  );
}
