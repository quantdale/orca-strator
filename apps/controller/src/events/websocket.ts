import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { EventBus } from './event-bus.js';
import type { RepositoryMutationEvent } from '@orca/shared';

export const websocketRoutes = (eventBus: EventBus): FastifyPluginAsync => {
  return async (fastify) => {
    const clients = new Set<WebSocket>();

    fastify.get('/api/events', { websocket: true }, (socket: WebSocket) => {
      clients.add(socket);
      const remove = () => clients.delete(socket);
      socket.on('close', remove);
      socket.on('error', remove);
    });

    // Serialize each event once for all connected clients instead of once per
    // client: during executor runs every output line is published, so the old
    // per-socket JSON.stringify multiplied CPU cost by the session count.
    const unsubscribe = eventBus.subscribe((event: RepositoryMutationEvent) => {
      if (clients.size === 0) return;
      const payload = JSON.stringify(event);
      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) {
          socket.send(payload);
        }
      }
    });

    fastify.addHook('onClose', async () => {
      unsubscribe();
      clients.clear();
    });
  };
};
