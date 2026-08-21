import type { FastifyPluginAsync } from "fastify";
import { strategyControlRequestSchema, swarmStartRequestSchema, type SwarmStartRequest, BadRequestError, DomainError } from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { RunStore } from "../../loop/run-store.js";
import type { SwarmExecutionService } from "../../strategy/swarm-execution-service.js";
import type { IterationExecutionCoordinator } from "../../loop/iteration-execution-coordinator.js";

export const swarmRoutes = (
  repositoryService: RepositoryService,
  runStore: RunStore,
  swarmService: SwarmExecutionService,
  coordinator: IterationExecutionCoordinator
): FastifyPluginAsync => async (fastify) => {
  const getRun = (repositoryId: string, runId: string) => {
    const repository = repositoryService.getRepository(repositoryId);
    const run = runStore.get(runId);
    if (!run || run.repositoryId !== repository.id) throw new DomainError("REPOSITORY_NOT_FOUND", "Campaign not found for repository.", 404);
    return { repository, run };
  };

  fastify.get<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/swarm",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      return { strategies: swarmService.listByRun(run.id) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string }; Body: SwarmStartRequest }>(
    "/api/repositories/:id/campaigns/:runId/swarm/start",
    async (request, reply) => {
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const input = swarmStartRequestSchema.parse(request.body);
      // Change 017 item #4: acquire the same campaign/iteration ownership boundary
      // used by the autonomous loop before allowing a strategy to start.
      try {
        coordinator.assertCampaignIterationOwnership(repository.id, run, {
          requestedStrategy: "SWARM",
          allowSolBoundary: true,
          authorizedDispatchId: run.activeDispatchId,
          authorizedStrategy: "SWARM"
        });
      } catch (err: any) {
        throw new BadRequestError(err?.message ? String(err.message) : "Campaign iteration ownership conflict.");
      }
      const strategy = await coordinator.start(
        repository.id,
        run,
        null,
        {
          packetIds: input.packetIds,
          maxConcurrency: input.maxConcurrency
        },
        "SWARM"
      );
      return reply.status(202).send({ strategy });
    }
  );

  fastify.get<{ Params: { id: string; runId: string; strategyRunId: string } }>(
    "/api/repositories/:id/campaigns/:runId/swarm/:strategyRunId",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const detail = swarmService.getDetail(request.params.id, run.id, request.params.strategyRunId);
      if (!detail) throw new DomainError("REPOSITORY_NOT_FOUND", "Swarm strategy run not found for campaign.", 404);
      return detail;
    }
  );

  fastify.post<{ Params: { id: string; runId: string; strategyRunId: string }; Body: unknown }>(
    "/api/repositories/:id/campaigns/:runId/swarm/:strategyRunId/control",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const body = strategyControlRequestSchema.parse(request.body);
      const strategy = swarmService.get(request.params.strategyRunId);
      if (!strategy || strategy.strategy !== "SWARM" || strategy.runId !== run.id) throw new DomainError("REPOSITORY_NOT_FOUND", "Swarm strategy run not found for campaign.", 404);
      const updated = await swarmService.control(request.params.id, strategy.strategyRunId, body.decision, body.reason ?? null);
      return { strategy: updated };
    }
  );

  fastify.post<{ Params: { id: string; runId: string; strategyRunId: string } }>(
    "/api/repositories/:id/campaigns/:runId/swarm/:strategyRunId/recover",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const recovered = await swarmService.recoverAll();
      const strategy = recovered.find((item) => item.strategyRunId === request.params.strategyRunId && item.runId === run.id);
      if (!strategy) {
        const existing = swarmService.get(request.params.strategyRunId);
        if (!existing || existing.strategy !== "SWARM" || existing.runId !== run.id) throw new DomainError("REPOSITORY_NOT_FOUND", "Swarm strategy run not found for campaign.", 404);
        return { strategy: existing };
      }
      return { strategy };
    }
  );
};
