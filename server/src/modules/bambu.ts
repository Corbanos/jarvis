/**
 * Bambu Lab printer integration over local MQTT.
 *
 * Requires three pieces of info, stored in ~/.jarvis/config.json:
 *   bambu: { host: "192.168.x.x", accessCode: "12345678", serial: "01..." }
 *
 * accessCode = LAN code shown on printer (Settings → WLAN)
 * serial     = Printer serial (Settings → About → Device info)
 */
import { BambuClient } from 'bambu-node';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_FILE = join(homedir(), '.jarvis', 'config.json');

export interface BambuConfig {
  host: string;
  accessCode: string;
  serial: string;
}

export function loadBambuConfig(): BambuConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { bambu?: BambuConfig };
    if (!cfg.bambu?.host || !cfg.bambu?.accessCode || !cfg.bambu?.serial) return null;
    return cfg.bambu;
  } catch {
    return null;
  }
}

export function saveBambuConfig(cfg: BambuConfig): void {
  mkdirSync(join(homedir(), '.jarvis'), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try { existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch { /* ignore */ }
  }
  existing['bambu'] = cfg;
  writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
}

let _client: BambuClient | null = null;
let _connected = false;
let _lastStatus: Record<string, unknown> = {};

/**
 * Get (or lazy-init) the Bambu MQTT client.
 */
export async function getClient(): Promise<BambuClient | null> {
  if (_client && _connected) return _client;

  const cfg = loadBambuConfig();
  if (!cfg) return null;

  if (_client) {
    // Already attempting connection — return existing
    return _client;
  }

  const options = {
    host: cfg.host,
    accessToken: cfg.accessCode,
    serialNumber: cfg.serial,
  };

  _client = new BambuClient(options);

  _client.on('printer:dataUpdate', (data: unknown) => {
    _lastStatus = { ...(_lastStatus ?? {}), ...(data as Record<string, unknown>) };
  });

  try {
    await _client.connect();
    _connected = true;
  } catch (err) {
    _connected = false;
    _client = null;
    throw err;
  }

  return _client;
}

export function isConfigured(): boolean {
  return loadBambuConfig() !== null;
}

export function isConnected(): boolean {
  return _connected;
}

export function getLastStatus(): Record<string, unknown> {
  return _lastStatus;
}

export async function disconnect(): Promise<void> {
  if (_client) {
    try { await _client.disconnect(); } catch { /* ignore */ }
    _client = null;
    _connected = false;
  }
}

/**
 * Get a snapshot of current printer status.
 */
export async function getStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  data: Record<string, unknown>;
} | { error: string }> {
  if (!isConfigured()) {
    return { error: 'Bambu printer not configured. Set host, accessCode, and serial in ~/.jarvis/config.json' };
  }

  try {
    await getClient();
    return {
      configured: true,
      connected: _connected,
      data: _lastStatus,
    };
  } catch (err) {
    return { error: `Connect failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
