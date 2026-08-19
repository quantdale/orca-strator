import type { FastifyPluginAsync } from "fastify";
import { startRunParamsSchema, type LoopStatusResponse, type RunRecord } from "@orca/shared";
import type { LoopService } from "../../loop/loop-service.js";
import type { RepositoryService } from "../../repositories/repository-service.js";

export const runRoutes = (
  loopService: LoopService,
  repositoryService: RepositoryService
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Params: { id: string }; Reply: { status: LoopStatusResponse } }>(
      "/api/repositories/:id/runs/active",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        const status = loopService.getStatus(request.params.id);
        return { status };
      }
    );

    fastify.post<{
      Params: { id: string };
      Body: { goal: string; maxIterations?: number };
      Reply: { run: RunRecord };
    }>(
      "/api/repositories/:id/runs/start",
      async (request, reply) => {
        repositoryService.getRepository(request.params.id);
        const params = startRunParamsSchema.parse(request.body);
        const run = await loopService.startRun(request.params.id, params);
        return reply.status(201).send({ run });
      }
    );

    fastify.post<{ Params: { id: string } }>(
      "/api/repositories/:id/runs/pause",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        await loopService.pauseRun(request.params.id);
        return { status: "paused" };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      "/api/repositories/:id/runs/resume",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        await loopService.resumeRun(request.params.id);
        return { status: "resumed" };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      "/api/repositories/:id/runs/stop",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        await loopService.stopRun(request.params.id);
        return { status: "stopped" };
      }
    );
  };
};
