'use client';
/**
 * Worldview event router.
 *
 * Server WS broadcasts events of type 'worldview' (action=open|close|focus|layer|layers|mode).
 * useJarvisWS dispatches them as window CustomEvents via emitWorldviewEvent.
 * This module:
 *   - On 'open' / 'focus': summons the workspace 'worldview' module (so it lives as a
 *     draggable HUD panel, not a fullscreen overlay).
 *   - On 'close': closes any worldview module.
 *   - On 'focus' / 'layer' / 'layers' / 'mode': re-broadcasts as window events that the
 *     WorldviewModule component listens to and forwards to the iframe via postMessage.
 *
 * The actual UI lives in `Workspace/index.tsx::WorldviewModule`.
 */
import { useEffect } from 'react';
import { useJarvisStore } from '@/lib/store';
import { useWorkspace, summon } from '@/lib/workspace';

export const WV_EVENT = 'jarvis-worldview-event';

export interface WorldviewPin {
  lat: number;
  lon: number;
  label: string;
  sub?: string;
  tag?: 'cyan' | 'amber' | 'green' | 'red';
}

export interface WorldviewCommand {
  action: 'open' | 'close' | 'focus' | 'layer' | 'layers' | 'mode' | 'pins' | 'clear-pins' | 'track' | 'untrack' | 'query';
  layer?: string;
  match?: string;
  lat?: number;
  lon?: number;
  name?: string;
  alt?: number;
  pitch?: number;
  enable?: boolean;
  layers?: Record<string, boolean>;
  mode?: 'normal' | 'nvg' | 'flir' | 'crt';
  pins?: WorldviewPin[];
  clear?: boolean;
  fit?: boolean;
}

export function emitWorldviewEvent(payload: WorldviewCommand) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WV_EVENT, { detail: payload }));
  }
}

/**
 * Hook this in once at the dashboard level — handles open/close at the
 * workspace level. The workspace WorldviewModule listens for the same event
 * and handles focus/layer/mode by forwarding to the iframe.
 */
export function useWorldviewWS() {
  const dismissNonce = useJarvisStore((s) => s.dismissNonce);

  useEffect(() => {
    function onCmd(e: Event) {
      const cmd = (e as CustomEvent).detail as WorldviewCommand;
      if (!cmd) return;
      const ws = useWorkspace.getState();
      // Any command that has visible effect needs the module mounted.
      // Only 'close' should NOT auto-summon.
      if (cmd.action === 'close') {
        ws.closeByType('worldview');
        return;
      }
      const existing = ws.modules.find((m) => m.type === 'worldview');
      if (!existing) {
        summon('worldview');
        // Replay this command on next tick so the freshly-mounted
        // WorldviewModule listener catches it. A second event with the
        // same detail is fine — handlers are idempotent.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(WV_EVENT, { detail: cmd }));
        }, 350);
      }
    }
    window.addEventListener(WV_EVENT, onCmd);
    return () => window.removeEventListener(WV_EVENT, onCmd);
  }, [dismissNonce]);
}

// Legacy export — still used by some imports but renders nothing now.
// The actual Worldview UI is the WorkspaceModule.
export function Worldview() {
  return null;
}
