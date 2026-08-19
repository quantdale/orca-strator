import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@orca/shared';
import type { DatabaseSync } from 'node:sqlite';

export const healthRoutes = (db: DatabaseSync): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: HealthResponse }>('/api/health', async (_request, reply) => {
      try {
        db.prepare('SELECT 1').get();

        const response: HealthResponse = {
          status: 'ok',
          service: 'orca-controller',
          version: '0.1.0'
        };
        return reply.status(200).send(response);
      } catch {
        return reply.status(503).send({
          status: 'error',
          service: 'orca-controller',
          version: '0.1.0'
        } as any);
      }
    });
  };
};
