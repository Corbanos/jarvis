'use client';

interface PrinterCardData {
  connected: boolean;
  data: Record<string, unknown>;
}

export function PrinterCard({ data }: { data: PrinterCardData }) {
  if (!data) return null;

  const d = data.data ?? {};
  const state = (d['gcode_state'] as string) ?? 'IDLE';
  const nozzle = num(d['nozzle_temper']);
  const nozzleTarget = num(d['nozzle_target_temper']);
  const bed = num(d['bed_temper']);
  const bedTarget = num(d['bed_target_temper']);
  const progress = num(d['mc_percent']);
  const remainMin = num(d['mc_remaining_time']);
  const layerCur = num(d['layer_num']);
  const layerTotal = num(d['total_layer_num']);
  const fileName = (d['gcode_file'] as string) ?? '—';

  const stateColor = state === 'RUNNING' ? 'var(--accent-green)' : state === 'PAUSE' ? 'var(--accent-amber)' : state === 'FAILED' ? 'var(--accent-red)' : 'var(--accent-primary)';

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(0,15,30,0.95) 0%, rgba(0,8,18,0.95) 100%)',
      border: '1px solid rgba(0,229,255,0.3)',
      borderRadius: 4, padding: '12px 14px', position: 'relative', overflow: 'hidden',
      boxShadow: '0 0 24px rgba(0,180,255,0.08)',
    }}>
      {(['tl','tr','bl','br'] as const).map((p) => <Corner key={p} pos={p} />)}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(0,229,255,0.1)' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: data.connected ? 'var(--accent-green)' : 'var(--accent-red)', boxShadow: `0 0 6px ${data.connected ? '#00ff9d' : '#ff3b3b'}`, animation: 'pulse-glow 2s infinite' }} />
        <span style={{ fontSize: 9, letterSpacing: '0.25em', color: 'var(--accent-primary)', fontWeight: 700 }}>
          ◇ BAMBU LAB · {data.connected ? 'ONLINE' : 'OFFLINE'}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(0,229,255,0.15)' }} />
        <span style={{ fontSize: 10, letterSpacing: '0.15em', color: stateColor, fontWeight: 700 }}>
          {state}
        </span>
      </div>

      {/* Big progress bar when printing */}
      {progress !== null && state === 'RUNNING' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-secondary)', letterSpacing: '0.1em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
              {String(fileName).split('/').pop()}
            </span>
            <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{progress}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(0,229,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--accent-secondary), var(--accent-bright))',
              boxShadow: '0 0 12px var(--accent-primary)',
              transition: 'width 1s ease',
            }} />
          </div>
          {remainMin !== null && (
            <div style={{ fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.15em', textAlign: 'right', marginTop: 2 }}>
              ETA: {formatMin(remainMin)}
            </div>
          )}
        </div>
      )}

      {/* Temps grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: layerCur !== null ? 10 : 0 }}>
        <TempStat label="NOZZLE" value={nozzle} target={nozzleTarget} />
        <TempStat label="BED" value={bed} target={bedTarget} />
      </div>

      {/* Layer counter */}
      {layerCur !== null && layerTotal !== null && layerTotal > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, paddingTop: 8, borderTop: '1px solid rgba(0,229,255,0.08)' }}>
          <span style={{ color: 'var(--text-dim)', letterSpacing: '0.2em' }}>LAYER</span>
          <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>
            {layerCur} / {layerTotal}
          </span>
        </div>
      )}
    </div>
  );
}

function TempStat({ label, value, target }: { label: string; value: number | null; target: number | null }) {
  const heating = target && value !== null && Math.abs(value - target) > 2;
  return (
    <div style={{
      background: 'rgba(0,12,24,0.5)',
      border: '1px solid rgba(0,229,255,0.1)',
      borderRadius: 3,
      padding: '8px 10px',
    }}>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', letterSpacing: '0.2em', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 18, color: heating ? 'var(--accent-amber)' : 'var(--accent-bright)', fontWeight: 800 }}>
          {value !== null ? value.toFixed(0) : '—'}°
        </span>
        {target !== null && target > 0 && (
          <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
            → {target.toFixed(0)}°
          </span>
        )}
      </div>
    </div>
  );
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? null : n; }
  return null;
}

function formatMin(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <div style={{
      position: 'absolute',
      top: pos.includes('t') ? 0 : undefined,
      bottom: pos.includes('b') ? 0 : undefined,
      left: pos.includes('l') ? 0 : undefined,
      right: pos.includes('r') ? 0 : undefined,
      width: 8, height: 8,
      borderTop: pos.includes('t') ? '2px solid var(--accent-primary)' : undefined,
      borderBottom: pos.includes('b') ? '2px solid var(--accent-primary)' : undefined,
      borderLeft: pos.includes('l') ? '2px solid var(--accent-primary)' : undefined,
      borderRight: pos.includes('r') ? '2px solid var(--accent-primary)' : undefined,
      zIndex: 2,
    }} />
  );
}
