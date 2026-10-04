import { requestContext, validIdentity } from './core/request-context.js';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { WSEvent } from './types/index.js';



export interface WSHub {
  broadcast(event: WSEvent): void;
  clientCount(): number;
}

export async function registerWS(app: FastifyInstance): Promise<WSHub> {
  const clients = new Map<WebSocket, string | undefined>();
  await app.register(import('@fastify/websocket'));

  app.get('/ws', { websocket: true }, (socket, request) => {
    const id = validIdentity((request.query as { clientId?: string }).clientId);
    clients.set(socket, id);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    socket.send(JSON.stringify({
      type: 'status',
      payload: { message: 'JARVIS ONLINE', clients: clients.size },
      timestamp: Date.now(),
    }));

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    socket.on('error', () => {
      clients.delete(socket);
    });
  });

  const hub: WSHub = {
    broadcast(event: WSEvent) {
      const ctx = requestContext.getStore();
      const routed = ctx?.clientId ? { ...event, payload: { ...event.payload, clientId: ctx.clientId, requestId: ctx.requestId } } : event;
      const msg = JSON.stringify(routed);
      for (const [client, clientId] of clients) {
        if (ctx?.clientId && clientId !== ctx.clientId) continue;
        // Unattributed background messages must never masquerade as a chat turn.
        if (!ctx?.clientId && ['thinking', 'message', 'dismiss', 'worldview'].includes(event.type)) continue;
        try {
          if (client.readyState === 1 /* OPEN */) {
            client.send(msg);
          }
        } catch {
          clients.delete(client);
        }
      }
    },
    clientCount() {
      return clients.size;
    },
  };

  return hub;
}
