import type { FastifyPluginAsync } from "fastify";
import type { WatcherStatusResponse, DispatchRecord } from "@orca/shared";
import type { WatcherService } from "../../watcher/watcher-service.js";
import type { DispatchStore } from "../../watcher/dispatch-store.js";
import type { RepositoryService } from "../../repositories/repository-service.js";

export const watcherRoutes = (
  watcherService: WatcherService,
  dispatchStore: DispatchStore,
  repositoryService: RepositoryService
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Params: { id: string }; Reply: { watcher: WatcherStatusResponse } }>(
      "/api/repositories/:id/watcher",
      async (request) => {
        // Ensures repository exists (throws RepositoryNotFoundError if not)
        repositoryService.getRepository(request.params.id);
        const watcher = watcherService.getWatcherStatus(request.params.id);
        return { watcher };
      }
    );

    fastify.get<{ Params: { id: string }; Reply: { dispatches: DispatchRecord[] } }>(
      "/api/repositories/:id/dispatches",
      async (request) => {
        repositoryService.getRepository(request.params.id);
        const dispatches = dispatchStore.getByRepository(request.params.id);
        return { dispatches };
      }
    );
  };
};
