import type { FastifyPluginAsync } from "fastify";
import { strategyControlRequestSchema, swarmStartRequestSchema, type SwarmStartRequest } from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { RunStore } from "../../loop/run-store.js";
import type { SwarmExecutionService } from "../../strategy/swarm-execution-service.js";

export const swarmRoutes = (
  repositoryService: RepositoryService,
  runStore: RunStore,
  swarmService: SwarmExecutionService
): FastifyPluginAsync => async (fastify) => {
  const getRun = (repositoryId: string, runId: string) => {
    const repository = repositoryService.getRepository(repositoryId);
    const run = runStore.get(runId);
    if (!run || run.repositoryId !== repository.id) throw new Error("Campaign not found for repository.");
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
      const { run } = getRun(request.params.id, request.params.runId);
      const input = swarmStartRequestSchema.parse(request.body);
      const strategy = swarmService.start(request.params.id, run.id, run.currentIteration, input);
      return reply.status(202).send({ strategy });
    }
  );

  fastify.get<{ Params: { id: string; runId: string; strategyRunId: string } }>(
    "/api/repositories/:id/campaigns/:runId/swarm/:strategyRunId",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const detail = swarmService.getDetail(request.params.id, run.id, request.params.strategyRunId);
      if (!detail) throw new Error("Swarm strategy run not found for campaign.");
      return detail;
    }
  );

  fastify.post<{ Params: { id: string; runId: string; strategyRunId: string }; Body: unknown }>(
    "/api/repositories/:id/campaigns/:runId/swarm/:strategyRunId/control",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const body = strategyControlRequestSchema.parse(request.body);
      const strategy = swarmService.get(request.params.strategyRunId);
      if (!strategy || strategy.runId !== run.id) throw new Error("Swarm strategy run not found for campaign.");
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
        if (!existing || existing.runId !== run.id) throw new Error("Swarm strategy run not found for campaign.");
        return { strategy: existing };
      }
      return { strategy };
    }
  );
};
