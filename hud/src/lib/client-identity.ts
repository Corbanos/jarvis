import { v4 as uuid } from 'uuid';
// Per document, NOT localStorage: duplicated tabs must not share an audio target.
// Remains stable across WebSocket reconnects. Reload creates a new audio target.
let clientId: string | undefined;
let sessionId: string | undefined;
export function getClientId(): string { return clientId ??= uuid(); }
export function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem('jarvis-session-id') || uuid();
    sessionStorage.setItem('jarvis-session-id', sessionId);
  } catch { sessionId = uuid(); }
  return sessionId;
}
/** WS carries UI/tool events, never audio or assistant speech. Chat uses its own SSE. */
export function acceptWSEvent(event: { type: string; payload?: { clientId?: string } }, id = getClientId()): boolean {
  if (event.payload?.clientId && event.payload.clientId !== id) return false;
  return !['thinking', 'message'].includes(event.type);
}
