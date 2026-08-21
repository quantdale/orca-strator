import type { FastifyPluginAsync } from 'fastify';
import type {
  PermissionDecision,
  RepositoryListResponse,
  RepositoryResponse
} from '@orca/shared';
import { DomainError, ValidationError } from '@orca/shared';
import type { PermissionStore } from '../../permissions/permission-store.js';
import { RepositoryService } from '../../repositories/repository-service.js';

const RESOLVABLE_OUTCOMES = ['ALLOW', 'ALLOW_ONCE', 'DENY'] as const;
type ResolvableOutcome = (typeof RESOLVABLE_OUTCOMES)[number];

export const repositoryRoutes = (
  service: RepositoryService,
  permissionStore: PermissionStore
): FastifyPluginAsync => {
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

    // Resolve a pending permission decision (API-CONTRACT §17: an ASK is a
    // durable decision for user attention, not an indefinite hidden wait).
    fastify.post<{ Params: { id: string; decisionId: string }; Body: unknown; Reply: { decision: PermissionDecision } }>(
      '/api/repositories/:id/permissions/decisions/:decisionId/resolve',
      async (request) => {
        const outcome = (request.body as { outcome?: unknown } | undefined)?.outcome;
        if (
          typeof outcome !== 'string' ||
          !(RESOLVABLE_OUTCOMES as readonly string[]).includes(outcome)
        ) {
          throw new ValidationError(
            `outcome must be one of: ${RESOLVABLE_OUTCOMES.join(', ')}.`
          );
        }

        const decision = permissionStore.getDecision(request.params.decisionId);
        const notFound = () =>
          new DomainError(
            'PERMISSION_DECISION_NOT_FOUND',
            `Permission decision "${request.params.decisionId}" not found for repository "${request.params.id}".`,
            404
          );
        if (!decision || decision.repositoryId !== request.params.id) {
          throw notFound();
        }
        // An already-resolved decision is durable history, not a rewrite target.
        if (decision.resolvedAt) {
          throw new DomainError(
            'PERMISSION_DECISION_ALREADY_RESOLVED',
            `Permission decision "${decision.id}" has already been resolved at ${decision.resolvedAt}.`,
            409
          );
        }

        const resolved = permissionStore.resolveDecision(decision.id, outcome as ResolvableOutcome);
        if (!resolved) {
          // Lost a concurrent-resolve race through the store's resolved_at guard.
          throw new DomainError(
            'PERMISSION_DECISION_ALREADY_RESOLVED',
            `Permission decision "${decision.id}" has already been resolved.`,
            409
          );
        }
        return { decision: resolved };
      }
    );
  };
};
