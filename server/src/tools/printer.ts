import type { ToolDefinition } from '../types/index.js';
import { getStatus, isConfigured, saveBambuConfig, loadBambuConfig } from '../modules/bambu.js';

let _broadcastCard: ((cardType: string, data: Record<string, unknown>) => void) | null = null;

export function setPrinterBroadcast(fn: (cardType: string, data: Record<string, unknown>) => void) {
  _broadcastCard = fn;
}

export const printerTool: ToolDefinition = {
  name: 'printer',
  description: `Bambu Lab 3D printer control over local network.

Use when the operator asks about:
- "What's the printer doing"
- "Print this STL"
- "Set up the printer" / "configure printer"
- "Pause / cancel the print"

If not yet configured, the operator must provide host (printer IP), accessCode (LAN code from printer screen),
and serial (from printer About page).

Status returns a structured printer card to the HUD.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'configure', 'config_check'],
        description: 'status = current state, configure = save credentials, config_check = is it set up',
      },
      host: { type: 'string', description: 'Printer IP (for configure)' },
      accessCode: { type: 'string', description: 'LAN access code from printer screen (for configure)' },
      serial: { type: 'string', description: 'Printer serial number (for configure)' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;

    switch (action) {
      case 'config_check': {
        const ok = isConfigured();
        if (!ok) {
          return `Printer NOT configured. Operator must provide:
  - host: Printer's local IP (Settings → WLAN on the printer)
  - accessCode: LAN access code (Settings → WLAN on the printer)
  - serial: Serial number (Settings → About → Device info)
Then call: printer(action="configure", host="...", accessCode="...", serial="...")`;
        }
        const cfg = loadBambuConfig();
        return `Printer configured. Host: ${cfg?.host}, Serial: ${cfg?.serial?.slice(-6)}.`;
      }

      case 'configure': {
        const host = input['host'] as string;
        const accessCode = input['accessCode'] as string;
        const serial = input['serial'] as string;
        if (!host || !accessCode || !serial) return 'Error: host, accessCode, and serial all required.';
        saveBambuConfig({ host, accessCode, serial });
        return `Printer credentials saved. Try printer(action="status") to verify connection.`;
      }

      case 'status': {
        const st = await getStatus();
        if ('error' in st) return st.error;

        // Send card to HUD
        if (_broadcastCard) {
          _broadcastCard('printer', {
            connected: st.connected,
            data: st.data,
          });
        }

        if (!st.connected) return 'Printer configured but not connected (yet). MQTT may take a moment.';

        const d = st.data as Record<string, unknown>;
        const summary = [
          d['gcode_state'] && `state: ${d['gcode_state']}`,
          d['nozzle_temper'] && `nozzle: ${d['nozzle_temper']}°C`,
          d['bed_temper'] && `bed: ${d['bed_temper']}°C`,
          d['mc_percent'] !== undefined && `progress: ${d['mc_percent']}%`,
          d['mc_remaining_time'] !== undefined && `remaining: ${d['mc_remaining_time']} min`,
        ].filter(Boolean).join(' · ');

        return `Bambu printer status: ${summary || 'idle'}.`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};
