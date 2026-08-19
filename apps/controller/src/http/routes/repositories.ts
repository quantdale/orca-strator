import type { FastifyPluginAsync } from 'fastify';
import type {
  RepositoryListResponse,
  RepositoryResponse
} from '@orca/shared';
import { RepositoryService } from '../../repositories/repository-service.js';

export const repositoryRoutes = (service: RepositoryService): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: RepositoryListResponse }>('/api/repositories', async () => {
      const repositories = service.listRepositories();
      return { repositories };
    });

    fastify.post<{ Body: unknown; Reply: RepositoryResponse }>(
      '/api/repositories',
      async (request, reply) => {
        const repository = service.createRepository(request.body);
        return reply.status(201).send({ repository });
      }
    );

    fastify.get<{ Params: { id: string }; Reply: RepositoryResponse }>(
      '/api/repositories/:id',
      async (request) => {
        const repository = service.getRepository(request.params.id);
        return { repository };
      }
    );

    fastify.patch<{ Params: { id: string }; Body: unknown; Reply: RepositoryResponse }>(
      '/api/repositories/:id',
      async (request) => {
        const repository = service.updateRepository(request.params.id, request.body);
        return { repository };
      }
    );

    fastify.delete<{ Params: { id: string } }>(
      '/api/repositories/:id',
      async (request, reply) => {
        service.deleteRepository(request.params.id);
        return reply.status(204).send();
      }
    );
  };
};
