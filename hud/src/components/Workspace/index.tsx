'use client';
import { useWorkspace, type ModuleInstance } from '@/lib/workspace';
import { FloatingPanel } from './FloatingPanel';
import { Dock } from './Dock';
import { JarvisChat } from '@/components/JarvisChat';
import { AgentSwarm } from '@/components/AgentSwarm';
import { SchedulerPanel } from '@/components/SchedulerPanel';
import { TelemetryFeed } from '@/components/TelemetryFeed';
import { SystemTelemetry } from '@/components/SystemTelemetry';
import { CadLibrary } from '@/components/Modules/CadLibrary';
import { CadPreviewModule } from '@/components/Modules/CadPreviewModule';
import { ShellModule } from '@/components/Modules/ShellModule';
import { useJarvisStore } from '@/lib/store';

export { Dock } from './Dock';

interface ModuleConfig {
  title: string;
  accent: string;
  statusFn?: (m: ModuleInstance) => 'green' | 'amber' | 'red' | 'none';
  Component: React.ComponentType<{ module: ModuleInstance }>;
}

const REGISTRY: Record<string, ModuleConfig> = {
  chat:       { title: 'JARVIS INTERFACE',  accent: '#00e5ff', Component: () => <JarvisChat /> },
  agents:     { title: 'AGENT NETWORK',     accent: '#ff8c00', Component: () => <AgentSwarm /> },
  scheduler:  { title: 'SCHEDULER',         accent: '#00e5ff', Component: () => <SchedulerPanel /> },
  telemetry:  { title: 'EVENT FEED',        accent: '#00e5ff', Component: () => <TelemetryFeed /> },
  system:     { title: 'SYSTEM TELEMETRY',  accent: '#00e5ff', Component: () => <SystemTelemetry /> },
  cad:        { title: 'CAD LIBRARY',       accent: '#00e5ff', Component: () => <CadLibrary /> },
  printer:    { title: 'BAMBU PRINTER',     accent: '#00e5ff', Component: () => <PrinterModule /> },
  worldview:  { title: 'WORLDVIEW',         accent: '#00ff9d', Component: () => <WorldviewModule /> },
  browser:    { title: 'BROWSER PREVIEW',   accent: '#00e5ff', Component: () => <BrowserPlaceholder /> },
  shell:      { title: 'SHELL',             accent: '#ff8c00', Component: () => <ShellModule /> },
  'cad-preview': { title: 'CAD PREVIEW',    accent: '#00e5ff', Component: ({ module }) => <CadPreviewModule module={module} /> },
};

export function Workspace() {
  const modules = useWorkspace((s) => s.modules);

  return (
    <>
      {modules.map((m) => {
        const cfg = REGISTRY[m.type];
        if (!cfg) return null;
        const status = m.type === 'agents' ? 'amber' : m.type === 'chat' ? 'green' : 'none';
        return (
          <FloatingPanel
            key={m.id}
            module={m}
            title={m.title ?? cfg.title}
            accentColor={cfg.accent}
            statusDot={status}
          >
            <cfg.Component module={m} />
          </FloatingPanel>
        );
      })}
      <Dock />
    </>
  );
}

// ── Embedded modules ──────────────────────────────────────────

function WorldviewModule() {
  return (
    <iframe
      src="/worldview/index.html"
      style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      title="WORLDVIEW"
    />
  );
}

function PrinterModule() {
  // For now, surface the PrinterCard with empty data — gets populated when status arrives
  // Long term: this should show live printer state, history, etc.
  const messages = useJarvisStore((s) => s.messages);
  // Find latest printer card in messages
  const printerMatch = [...messages].reverse().find((m) =>
    m.text.includes('<jarvis-card type="printer"')
  );
  let data: Record<string, unknown> | null = null;
  if (printerMatch) {
    const m = printerMatch.text.match(/<jarvis-card type="printer">([\s\S]*?)<\/jarvis-card>/);
    if (m && m[1]) {
      try { data = JSON.parse(m[1]); } catch { /* ignore */ }
    }
  }

  if (!data) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>⎙</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>NO PRINTER STATUS YET</div>
        <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7 }}>
          Ask Jarvis: &quot;what&apos;s the printer doing?&quot;
        </div>
      </div>
    );
  }

  // Lazy import to avoid circular
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { PrinterCard } = require('@/components/JarvisCards/PrinterCard') as typeof import('@/components/JarvisCards/PrinterCard');
  return (
    <div style={{ padding: 8 }}>
      <PrinterCard data={data as unknown as Parameters<typeof PrinterCard>[0]['data']} />
    </div>
  );
}

function BrowserPlaceholder() {
  return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)' }}>
      <div style={{ fontSize: 32, color: 'var(--accent-primary)', opacity: 0.3, marginBottom: 8 }}>◌</div>
      <div style={{ fontSize: 10, letterSpacing: '0.2em' }}>BROWSER MODULE</div>
      <div style={{ fontSize: 9, marginTop: 6, opacity: 0.7, padding: '0 12px', lineHeight: 1.6 }}>
        Jarvis controls its own Chromium window via Playwright. Ask him to browse a site —
        the window opens on your desktop, separate from this HUD.
      </div>
    </div>
  );
}
