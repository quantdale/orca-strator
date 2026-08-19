import type { FastifyPluginAsync } from "fastify";
import type { BrowserStatus, SolWakeRecord } from "@orca/shared";
import type { BrowserManager } from "../../browser/browser-manager.js";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { DispatchStore } from "../../watcher/dispatch-store.js";
import { ValidationError } from "@orca/shared";

export const browserRoutes = (
  browserManager: BrowserManager,
  repositoryService: RepositoryService,
  dispatchStore: DispatchStore
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { browser: BrowserStatus } }>(
      "/api/browser/status",
      async () => {
        const browser = browserManager.getStatus();
        return { browser };
      }
    );

    fastify.post(
      "/api/browser/setup/open",
      async () => {
        await browserManager.openSetupBrowser();
        return { status: "opened" };
      }
    );

    fastify.post(
      "/api/browser/setup/close",
      async () => {
        await browserManager.closeSetupBrowser();
        return { status: "closed" };
      }
    );

    fastify.post<{
      Params: { id: string };
      Body: { dispatchId?: string };
      Reply: { wake: SolWakeRecord };
    }>(
      "/api/repositories/:id/wake",
      async (request, reply) => {
        const repo = repositoryService.getRepository(request.params.id);

        let dispatchId = request.body?.dispatchId;
        if (!dispatchId) {
          const dispatches = dispatchStore.getByRepository(repo.id);
          const firstDispatch = dispatches[0];
          if (!firstDispatch) {
            throw new ValidationError(`No dispatches found for repository ${repo.id}`);
          }
          dispatchId = firstDispatch.id;
        }

        const dispatch = dispatchStore.get(dispatchId);
        if (!dispatch) {
          throw new ValidationError(`Dispatch ${dispatchId} not found`);
        }

        const wake = await browserManager.submitSolWake(repo.id, {
          repositoryName: repo.displayName,
          runId: dispatch.runId,
          iteration: dispatch.iteration,
          dispatchId: dispatch.id,
          resultStatus: "COMPLETED",
          conversationUrl: repo.solConversationUrl
        });

        return reply.status(201).send({ wake });
      }
    );
  };
};
