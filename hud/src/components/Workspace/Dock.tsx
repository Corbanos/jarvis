'use client';
import { useWorkspace, summon, type ModuleType } from '@/lib/workspace';
import { useJarvisStore } from '@/lib/store';

interface DockEntry {
  type: ModuleType;
  label: string;
  icon: string;
  description: string;
}

const DOCK_ENTRIES: DockEntry[] = [
  { type: 'chat',          label: 'JARVIS',     icon: 'J',   description: 'Main assistant' },
  { type: 'agents',        label: 'AGENTS',     icon: '◇',   description: 'Active sub-agents (compact)' },
  { type: 'agent-control', label: 'CONTROL',    icon: '⎔',   description: 'Agent Control Panel' },
  { type: 'scheduler',     label: 'SCHEDULE',   icon: '◷',   description: 'Scheduled tasks' },
  { type: 'projects',      label: 'PROJECTS',   icon: '◆',   description: 'Multi-session work + sign-off' },
  { type: 'library',       label: 'LIBRARY',    icon: '▦',   description: 'Apps Jarvis built for you' },
  { type: 'cad',           label: 'CAD',        icon: '◈',   description: 'CAD library' },
  { type: 'printer',       label: 'PRINTER',    icon: '⎙',   description: 'Bambu printer' },
  { type: 'worldview',     label: 'WORLDVIEW',  icon: '⊕',   description: 'Globe + OSINT' },
  { type: 'system',        label: 'SYSTEM',     icon: '◐',   description: 'System telemetry' },
  { type: 'telemetry',     label: 'EVENTS',     icon: '☰',   description: 'Live event feed' },
  { type: 'shell',         label: 'SHELL',      icon: '$',   description: 'Quick shell exec' },
  { type: 'browser',       label: 'BROWSER',    icon: '◌',   description: 'Jarvis browser' },
];

export function Dock() {
  const modules = useWorkspace((s) => s.modules);
  const closeByType = useWorkspace((s) => s.closeByType);
  const focus = useWorkspace((s) => s.focus);
  const resetLayout = useWorkspace((s) => s.resetLayout);
  const agents = useJarvisStore((s) => s.agents);
  const runningAgents = agents.filter((a) => a.status === 'running');

  return (
    <div style={{
      position: 'fixed',
      bottom: 12,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 100,
      display: 'flex',
      gap: 4,
      padding: '6px 10px',
      background: 'rgba(0,4,12,0.94)',
      border: '1px solid rgba(0,229,255,0.3)',
      borderRadius: 6,
      boxShadow: '0 0 30px rgba(0,180,255,0.15), 0 4px 16px rgba(0,0,0,0.7)',
      backdropFilter: 'blur(12px)',
      alignItems: 'center',
    }}>
      {DOCK_ENTRIES.map((e) => {
        const open = modules.some((m) => m.type === e.type);
        const instance = modules.find((m) => m.type === e.type);
        const hasActivity = (e.type === 'agents' || e.type === 'agent-control') && runningAgents.length > 0;
        
        return (
          <DockButton
            key={e.type}
            entry={e}
            open={open}
            hasActivity={hasActivity}
            activityCount={hasActivity ? runningAgents.length : 0}
            onClick={() => {
              if (open && instance) {
                // If already open, focus it (or close on second click — let's go with focus)
                focus(instance.id);
              } else {
                summon(e.type);
              }
            }}
            onRightClick={(ev) => {
              ev.preventDefault();
              if (open) closeByType(e.type);
            }}
          />
        );
      })}
      <div style={{ width: 1, height: 24, background: 'rgba(0,229,255,0.2)', margin: '0 4px' }} />
      <button
        onClick={() => { if (confirm('Reset workspace layout?')) resetLayout(); }}
        title="Reset workspace"
        style={{
          background: 'transparent', border: '1px solid rgba(255,140,0,0.3)',
          color: 'var(--accent-amber)', width: 36, height: 36, borderRadius: 4,
          cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
        }}
      >↻</button>
    </div>
  );
}

function DockButton({ 
  entry, 
  open, 
  hasActivity,
  activityCount,
  onClick, 
  onRightClick 
}: { 
  entry: DockEntry; 
  open: boolean;
  hasActivity: boolean;
  activityCount: number;
  onClick: () => void; 
  onRightClick: (e: React.MouseEvent) => void;
}) {
  const activeColor = hasActivity ? '#ff8c00' : 'var(--accent-bright)';
  const activeBorderColor = hasActivity ? 'rgba(255,140,0,0.6)' : 'rgba(0,229,255,0.6)';
  const activeBgColor = hasActivity ? 'rgba(255,140,0,0.15)' : 'rgba(0,229,255,0.15)';
  
  return (
    <button
      onClick={onClick}
      onContextMenu={onRightClick}
      title={`${entry.label} — ${entry.description}\n(right-click to close)`}
      style={{
        position: 'relative',
        width: 44, height: 44,
        background: open ? activeBgColor : 'transparent',
        border: `1px solid ${open ? activeBorderColor : 'rgba(0,229,255,0.15)'}`,
        borderRadius: 4,
        color: open ? activeColor : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 2,
        transition: 'all 0.15s',
        boxShadow: open ? `0 0 12px ${hasActivity ? 'rgba(255,140,0,0.3)' : 'rgba(0,229,255,0.3)'}` : 'none',
      }}
      onMouseEnter={(e) => {
        if (!open) e.currentTarget.style.borderColor = 'rgba(0,229,255,0.4)';
      }}
      onMouseLeave={(e) => {
        if (!open) e.currentTarget.style.borderColor = 'rgba(0,229,255,0.15)';
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 700 }}>{entry.icon}</span>
      <span style={{ fontSize: 7, letterSpacing: '0.15em', fontWeight: 700, lineHeight: 1 }}>{entry.label}</span>
      
      {/* Open indicator */}
      {open && (
        <div style={{
          position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
          width: 16, height: 2,
          background: activeColor,
          borderRadius: 1,
          boxShadow: `0 0 6px ${activeColor}`,
        }} />
      )}
      
      {/* Activity badge */}
      {hasActivity && activityCount > 0 && (
        <div style={{
          position: 'absolute',
          top: -4,
          right: -4,
          background: '#ff8c00',
          color: '#000',
          fontSize: 8,
          fontWeight: 700,
          width: 16,
          height: 16,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 8px rgba(255,140,0,0.6)',
          animation: 'pulse-glow 1.5s infinite',
        }}>
          {activityCount}
        </div>
      )}
    </button>
  );
}
