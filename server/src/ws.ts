import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { WSEvent } from './types/index.js';

const clients = new Set<WebSocket>();

export interface WSHub {
  broadcast(event: WSEvent): void;
  clientCount(): number;
}

export async function registerWS(app: FastifyInstance): Promise<WSHub> {
  await app.register(import('@fastify/websocket'));

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
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
      const msg = JSON.stringify(event);
      for (const client of clients) {
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
