import type { FastifyPluginAsync } from "fastify";
import { dagStartRequestSchema, strategyControlRequestSchema, type DagStartRequest } from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { RunStore } from "../../loop/run-store.js";
import type { DagExecutionService } from "../../strategy/dag-execution-service.js";

export const dagRoutes = (
  repositoryService: RepositoryService,
  runStore: RunStore,
  dagService: DagExecutionService
): FastifyPluginAsync => async (fastify) => {
  const getRun = (repositoryId: string, runId: string) => {
    const repository = repositoryService.getRepository(repositoryId);
    const run = runStore.get(runId);
    if (!run || run.repositoryId !== repository.id) throw new Error("Campaign not found for repository.");
    return { repository, run };
  };

  fastify.get<{ Params: { id: string; runId: string } }>(
    "/api/repositories/:id/campaigns/:runId/dag",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      return { strategies: dagService.listByRun(run.id) };
    }
  );

  fastify.post<{ Params: { id: string; runId: string }; Body: DagStartRequest }>(
    "/api/repositories/:id/campaigns/:runId/dag/start",
    async (request, reply) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const input = dagStartRequestSchema.parse(request.body);
      const strategy = dagService.start(request.params.id, run.id, run.currentIteration, input);
      return reply.status(202).send({ strategy });
    }
  );

  fastify.get<{ Params: { id: string; runId: string; strategyRunId: string } }>(
    "/api/repositories/:id/campaigns/:runId/dag/:strategyRunId",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const detail = dagService.getDetail(request.params.id, run.id, request.params.strategyRunId);
      if (!detail) throw new Error("DAG strategy run not found for campaign.");
      return detail;
    }
  );

  fastify.post<{ Params: { id: string; runId: string; strategyRunId: string }; Body: unknown }>(
    "/api/repositories/:id/campaigns/:runId/dag/:strategyRunId/control",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const body = strategyControlRequestSchema.parse(request.body);
      const strategy = dagService.get(request.params.strategyRunId);
      if (!strategy || strategy.runId !== run.id) throw new Error("DAG strategy run not found for campaign.");
      const updated = await dagService.control(request.params.id, strategy.strategyRunId, body.decision, body.reason ?? null);
      return { strategy: updated };
    }
  );

  fastify.post<{ Params: { id: string; runId: string; strategyRunId: string } }>(
    "/api/repositories/:id/campaigns/:runId/dag/:strategyRunId/recover",
    async (request) => {
      const { run } = getRun(request.params.id, request.params.runId);
      const recovered = await dagService.recoverAll();
      const strategy = recovered.find((item) => item.strategyRunId === request.params.strategyRunId && item.runId === run.id);
      if (!strategy) {
        const existing = dagService.get(request.params.strategyRunId);
        if (!existing || existing.runId !== run.id) throw new Error("DAG strategy run not found for campaign.");
        return { strategy: existing };
      }
      return { strategy };
    }
  );
};
