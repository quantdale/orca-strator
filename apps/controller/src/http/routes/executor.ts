import type { FastifyPluginAsync } from "fastify";
import type { ExecutorStatusResponse } from "@orca/shared";
import type { ExecutorService } from "../../executor/executor-service.js";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { IterationExecutionCoordinator } from "../../loop/iteration-execution-coordinator.js";

export const executorRoutes = (
  executorService: ExecutorService,
  repositoryService: RepositoryService,
  coordinator: IterationExecutionCoordinator
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Params: { id: string }; Reply: { executor: ExecutorStatusResponse } }>(
      "/api/repositories/:id/executor",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        const executor = executorService.getStatus(request.params.id);
        return { executor };
      }
    );

    fastify.get<{ Params: { id: string }; Reply: { logs: string[] } }>(
      "/api/repositories/:id/executor/logs",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        const logs = executorService.getLogs(request.params.id);
        return { logs };
      }
    );

    fastify.post<{ Params: { id: string }; Body: { dispatchId: string } }>(
      "/api/repositories/:id/executor/start",
      async (request, reply) => {
        repositoryService.getRepository(request.params.id);
        // F-MED-3: raw executor starts honor the shutdown admissions gate.
        if (!coordinator.isAdmittingStarts()) {
          return reply.status(503).send({
            error: {
              code: "SHUTTING_DOWN",
              message:
                "Controller is shutting down; new executor starts are rejected.",
            },
          });
        }
        const run = await executorService.startRun(request.params.id, request.body.dispatchId);
        return reply.status(201).send({ run });
      }
    );

    fastify.post<{ Params: { id: string } }>(
      "/api/repositories/:id/executor/pause",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        await executorService.pauseRun(request.params.id);
        return { status: "paused" };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      "/api/repositories/:id/executor/kill",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        await executorService.killRun(request.params.id);
        return { status: "killed" };
      }
    );
  };
};
