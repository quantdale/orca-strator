import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { EventBus } from './event-bus.js';
import type { RepositoryMutationEvent } from '@orca/shared';

export const websocketRoutes = (eventBus: EventBus): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get('/api/events', { websocket: true }, (socket: WebSocket) => {
      const unsubscribe = eventBus.subscribe((event: RepositoryMutationEvent) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      });

      socket.on('close', () => {
        unsubscribe();
      });

      socket.on('error', () => {
        unsubscribe();
      });
    });
  };
};
