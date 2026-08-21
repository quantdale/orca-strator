import type { FastifyPluginAsync } from "fastify";
import { dagStartRequestSchema, strategyControlRequestSchema, type DagStartRequest, BadRequestError } from "@orca/shared";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { RunStore } from "../../loop/run-store.js";
import type { DagExecutionService } from "../../strategy/dag-execution-service.js";
import type { IterationExecutionCoordinator } from "../../loop/iteration-execution-coordinator.js";

export const dagRoutes = (
  repositoryService: RepositoryService,
  runStore: RunStore,
  dagService: DagExecutionService,
  coordinator: IterationExecutionCoordinator
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
      const { repository, run } = getRun(request.params.id, request.params.runId);
      const input = dagStartRequestSchema.parse(request.body);
      // Change 017 item #4: acquire the same campaign/iteration ownership boundary
      // used by the autonomous loop before allowing a strategy to start.
      try {
        coordinator.assertCampaignIterationOwnership(repository.id, run, {
          requestedStrategy: "DAG",
          allowSolBoundary: true,
          authorizedDispatchId: run.activeDispatchId,
          authorizedStrategy: "DAG"
        });
      } catch (err: any) {
        throw new BadRequestError(err?.message ? String(err.message) : "Campaign iteration ownership conflict.");
      }
      const strategy = await coordinator.start(
        repository.id,
        run,
        null,
        {
          dagNodes: input.nodes,
          maxConcurrency: input.maxConcurrency
        },
        "DAG"
      );
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
