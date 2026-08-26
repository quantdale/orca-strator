import type { FastifyPluginAsync } from "fastify";
import type {
  AuthReadinessReport,
  BrowserStatus,
  SolWakeRecord,
} from "@orca/shared";
import type { BrowserManager } from "../../browser/browser-manager.js";
import type { RepositoryService } from "../../repositories/repository-service.js";
import type { DispatchStore } from "../../watcher/dispatch-store.js";
import type { RunStore } from "../../loop/run-store.js";
import { ValidationError } from "@orca/shared";

export const browserRoutes = (
  browserManager: BrowserManager,
  repositoryService: RepositoryService,
  dispatchStore: DispatchStore,
  runStore: RunStore,
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { browser: BrowserStatus } }>(
      "/api/browser/status",
      async () => {
        const browser = browserManager.getStatus();
        return { browser };
      },
    );

    fastify.post("/api/browser/setup/open", async () => {
      await browserManager.openSetupBrowser();
      return { status: "opened" };
    });

    fastify.post("/api/browser/setup/close", async () => {
      await browserManager.closeSetupBrowser();
      return { status: "closed" };
    });

    /**
     * Change 023: auth readiness for the dedicated profile. 409-safe: when the
     * profile is busy this returns UNKNOWN with a profile-busy evidence label
     * instead of failing.
     */
    fastify.post<{ Reply: { auth: AuthReadinessReport } }>(
      "/api/browser/auth/check",
      async () => {
        const auth = await browserManager.checkAuthReadiness();
        return { auth };
      },
    );

    fastify.post<{
      Params: { id: string };
      Body: { dispatchId?: string };
      Reply: { wake: SolWakeRecord };
    }>("/api/repositories/:id/wake", async (request, reply) => {
      const repo = repositoryService.getRepository(request.params.id);

      let dispatchId = request.body?.dispatchId;
      if (!dispatchId) {
        const dispatches = dispatchStore.getByRepository(repo.id);
        const firstDispatch = dispatches[0];
        if (!firstDispatch) {
          throw new ValidationError(
            `No dispatches found for repository ${repo.id}`,
          );
        }
        dispatchId = firstDispatch.id;
      }

      const dispatch = dispatchStore.get(dispatchId);
      if (!dispatch) {
        throw new ValidationError(`Dispatch ${dispatchId} not found`);
      }
      // Wake attribution is contractual: the wake event attaches to a durable
      // campaign timeline. Detected-but-unconsumed or rejected dispatches have
      // no durable run (sentinel/pre-run IDs would violate campaign-trace FK
      // integrity), so they are refused instead of silently mis-attributed.
      if (!runStore.get(dispatch.runId)) {
        throw new ValidationError(
          `Dispatch ${dispatchId} references run "${dispatch.runId}" which has no durable campaign`,
        );
      }

      const wake = await browserManager.submitSolWake(repo.id, {
        repositoryName: repo.displayName,
        runId: dispatch.runId,
        iteration: dispatch.iteration,
        dispatchId: dispatch.id,
        resultStatus: "COMPLETED",
        conversationUrl: repo.solConversationUrl,
      });

      return reply.status(201).send({ wake });
    });
  };
};
