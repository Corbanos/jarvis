'use client';
/**
 * WorldviewModule — HUD-styled wrapper around the Cesium /worldview iframe.
 *
 * Provides:
 *   - The iframe (rendered using existing /worldview/index.html)
 *   - A blue/black left sidebar with per-layer toggles + render mode + focus search
 *   - Bridge: listens to window 'jarvis-worldview-event' and forwards as
 *     postMessage('worldview:focus|layer|layers|mode') to the iframe.
 */
import { useEffect, useRef, useState } from 'react';
import { WV_EVENT, type WorldviewCommand } from '@/components/Worldview';

const LAYERS: Array<{ id: string; label: string; group: string }> = [
  { id: 'flights',    label: 'COMMERCIAL FLIGHTS',  group: 'AIR' },
  { id: 'military',   label: 'MILITARY AIRCRAFT',   group: 'AIR' },
  { id: 'satellites', label: 'SATELLITES',          group: 'ORBITAL' },
  { id: 'iss',        label: 'ISS',                 group: 'ORBITAL' },
  { id: 'cctv',       label: 'CCTV / CAMERAS',      group: 'GROUND' },
  { id: 'traffic',    label: 'TRAFFIC',             group: 'GROUND' },
  { id: 'ships',      label: 'SHIPPING',            group: 'SEA' },
  { id: 'seismic',    label: 'SEISMIC EVENTS',      group: 'NATURAL' },
  { id: 'wildfires',  label: 'WILDFIRES',           group: 'NATURAL' },
  { id: 'weather',    label: 'WEATHER SYSTEMS',     group: 'NATURAL' },
  { id: 'aqi',        label: 'AIR QUALITY',         group: 'NATURAL' },
  { id: 'nuclear',    label: 'NUCLEAR PLANTS',      group: 'STRATEGIC' },
  { id: 'bases',      label: 'MILITARY BASES',      group: 'STRATEGIC' },
];

const MODES = [
  { id: 'normal', label: 'NORMAL' },
  { id: 'nvg',    label: 'NVG' },
  { id: 'flir',   label: 'FLIR' },
  { id: 'crt',    label: 'CRT' },
] as const;

export function WorldviewModule() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<string>('normal');
  const [layerState, setLayerState] = useState<Record<string, boolean>>({});
  const [focusName, setFocusName] = useState<string>('');
  const [collapsed, setCollapsed] = useState(false);
  const [pinCount, setPinCount] = useState(0);

  // Listen for postMessage from iframe (state snapshots, ready)
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'worldview:ready') {
        setReady(true);
      } else if (data.type === 'worldview:state') {
        if (data.layers && typeof data.layers === 'object') setLayerState(data.layers);
        if (typeof data.mode === 'string') setMode(data.mode);
        if (typeof data.pinCount === 'number') setPinCount(data.pinCount);
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Forward jarvis-worldview-event commands to the iframe
  useEffect(() => {
    function onCmd(e: Event) {
      const cmd = (e as CustomEvent).detail as WorldviewCommand;
      if (!cmd) return;
      const post = (msg: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(msg, '*');
      };
      switch (cmd.action) {
        case 'focus':
          if (typeof cmd.lat === 'number' && typeof cmd.lon === 'number') {
            setFocusName(cmd.name ?? '');
            post({ type: 'worldview:focus', lat: cmd.lat, lon: cmd.lon, name: cmd.name, alt: cmd.alt, pitch: cmd.pitch });
          }
          break;
        case 'layer':
          if (cmd.name) post({ type: 'worldview:layer', name: cmd.name, enable: !!cmd.enable });
          break;
        case 'layers':
          if (cmd.layers) post({ type: 'worldview:layers', layers: cmd.layers });
          break;
        case 'mode':
          if (cmd.mode) post({ type: 'worldview:mode', mode: cmd.mode });
          break;
        case 'pins':
          post({ type: 'worldview:pins', pins: cmd.pins ?? [], clear: !!cmd.clear, fit: cmd.fit !== false });
          break;
        case 'clear-pins':
          post({ type: 'worldview:clear-pins' });
          break;
        case 'track':
          post({ type: 'worldview:track', layer: cmd.layer ?? 'flights', match: cmd.match ?? '' });
          break;
        case 'untrack':
          post({ type: 'worldview:untrack' });
          break;
      }
    }
    window.addEventListener(WV_EVENT, onCmd);
    return () => window.removeEventListener(WV_EVENT, onCmd);
  }, []);

  function manualToggle(id: string) {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'worldview:layer',
      name: id,
      enable: !layerState[id],
    }, '*');
    // optimistic update; the iframe will echo back the real state
    setLayerState((s) => ({ ...s, [id]: !s[id] }));
  }

  function manualMode(m: string) {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'worldview:mode',
      mode: m,
    }, '*');
    setMode(m);
  }

  // Group layers
  const grouped = LAYERS.reduce<Record<string, typeof LAYERS>>((acc, l) => {
    (acc[l.group] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      width: '100%',
      background: '#000',
      color: '#cfefff',
      fontFamily: 'inherit',
    }}>
      {/* Layer Sidebar */}
      <div style={{
        width: collapsed ? 28 : 200,
        flexShrink: 0,
        borderRight: '1px solid rgba(0,229,255,0.2)',
        background: 'rgba(0,8,18,0.95)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.2s',
      }}>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'rgba(0,229,255,0.05)',
            border: 'none',
            borderBottom: '1px solid rgba(0,229,255,0.15)',
            color: 'var(--accent-primary)',
            padding: '6px 8px',
            cursor: 'pointer',
            fontSize: 9,
            letterSpacing: '0.2em',
            fontFamily: 'inherit',
            textAlign: collapsed ? 'center' : 'left',
            fontWeight: 700,
          }}
        >
          {collapsed ? '▶' : '◀ INTEL LAYERS'}
        </button>

        {!collapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
            {/* Mode selector */}
            <div style={{ padding: '4px 8px', marginBottom: 8 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--text-dim)', marginBottom: 4 }}>RENDER MODE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => manualMode(m.id)}
                    style={{
                      background: mode === m.id ? 'rgba(0,229,255,0.2)' : 'rgba(0,229,255,0.04)',
                      border: `1px solid ${mode === m.id ? 'rgba(0,229,255,0.6)' : 'rgba(0,229,255,0.2)'}`,
                      borderRadius: 2,
                      color: mode === m.id ? 'var(--accent-bright)' : 'var(--text-secondary)',
                      fontSize: 8,
                      letterSpacing: '0.15em',
                      padding: '4px 0',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 700,
                    }}
                  >{m.label}</button>
                ))}
              </div>
            </div>

            {/* Layer groups */}
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{
                  fontSize: 8,
                  letterSpacing: '0.25em',
                  color: 'var(--text-dim)',
                  padding: '4px 8px 2px',
                  borderBottom: '1px solid rgba(0,229,255,0.08)',
                  marginBottom: 2,
                }}>{group}</div>
                {items.map((l) => {
                  const on = !!layerState[l.id];
                  return (
                    <button
                      key={l.id}
                      onClick={() => manualToggle(l.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        borderLeft: `2px solid ${on ? 'var(--accent-primary)' : 'transparent'}`,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: on ? 'var(--accent-primary)' : 'transparent',
                        border: `1px solid ${on ? 'var(--accent-primary)' : 'rgba(0,229,255,0.4)'}`,
                        boxShadow: on ? '0 0 6px rgba(0,229,255,0.6)' : 'none',
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 9,
                        letterSpacing: '0.05em',
                        color: on ? 'var(--accent-bright)' : 'var(--text-secondary)',
                        fontWeight: on ? 700 : 400,
                      }}>{l.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {!collapsed && (
          <>
            {pinCount > 0 && (
              <div style={{
                padding: '6px 8px',
                borderTop: '1px solid rgba(0,229,255,0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ fontSize: 9, color: 'var(--accent-amber)', letterSpacing: '0.15em' }}>
                  ◇ {pinCount} PIN{pinCount === 1 ? '' : 'S'}
                </span>
                <button
                  onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'worldview:clear-pins' }, '*')}
                  style={{
                    background: 'rgba(255,59,59,0.08)',
                    border: '1px solid rgba(255,59,59,0.3)',
                    borderRadius: 2,
                    color: '#ff5577',
                    fontSize: 8,
                    letterSpacing: '0.15em',
                    padding: '3px 7px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 700,
                  }}
                >CLEAR</button>
              </div>
            )}
            <div style={{
              padding: '6px 8px',
              borderTop: '1px solid rgba(0,229,255,0.1)',
              fontSize: 8,
              color: 'var(--text-dim)',
              letterSpacing: '0.15em',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span style={{ color: ready ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                {ready ? '● ONLINE' : '◌ BOOT…'}
              </span>
              {focusName && (
                <span style={{ color: 'var(--accent-amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                  {focusName.toUpperCase()}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* The Cesium globe iframe */}
      <iframe
        ref={iframeRef}
        src="/worldview/index.html"
        style={{ flex: 1, border: 'none', background: '#000' }}
        title="WORLDVIEW"
      />
    </div>
  );
}
