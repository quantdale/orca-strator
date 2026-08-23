import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@orca/shared';
import type { DatabaseSync } from 'node:sqlite';
import type { ControllerIdentity } from '@orca/shared';

export const healthRoutes = (
  db: DatabaseSync,
  identity: ControllerIdentity
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: HealthResponse }>('/api/health', async (_request, reply) => {
      try {
        db.prepare('SELECT 1').get();

        const response: HealthResponse = {
          status: 'ok',
          service: identity.service,
          version: identity.version
        };
        return reply.status(200).send(response);
      } catch {
        return reply.status(503).send({
          status: 'error',
          service: identity.service,
          version: identity.version
        } as any);
      }
    });
  };
};
