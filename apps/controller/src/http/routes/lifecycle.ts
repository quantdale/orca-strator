import type { FastifyPluginAsync } from "fastify";
import type { RunStore } from "../../loop/run-store.js";
import { controlTokenMatches } from "../../runtime/singleton-lock.js";

/**
 * Authenticated lifecycle control (Change 026).
 *
 * Trusted desktop main-process operations may probe quiescence and request a
 * graceful shutdown. Every request MUST present the per-start control token
 * from runtime-lock metadata via the `x-orca-control-token` header; the token
 * never appears in any HTTP response and browsers cannot read local files, so
 * neither renderer JavaScript nor arbitrary web pages gain process-control
 * authority. There is deliberately no unauthenticated shutdown path.
 */

export interface LifecycleControl {
  controlToken: string;
  /** Initiates the same graceful teardown as SIGTERM; never force-kills. */
  requestShutdown: (reason: string) => void;
}

export interface LifecycleQuiescence {
  state: "idle" | "active-campaigns";
  activeCampaigns: { repositoryId: string; runId: string; loopState: string }[];
  pid: number;
}

const TOKEN_HEADER = "x-orca-control-token";

export function lifecycleRoutes(
  deps: {
    runStore: RunStore;
    identityPid: number;
    control: LifecycleControl | null;
  }
): FastifyPluginAsync {
  return async (fastify) => {
    const authorize = (headers: unknown): boolean => {
      if (!deps.control) return false;
      const presented = (headers as Record<string, unknown>)?.[TOKEN_HEADER];
      return controlTokenMatches(presented, deps.control.controlToken);
    };

    fastify.get(
      "/api/system/lifecycle",
      async (request, reply) => {
        if (!authorize(request.headers)) {
          void reply.code(401);
          return reply.send({ error: "UNAUTHORIZED", message: "Missing or invalid control token." });
        }
        const active = deps.runStore.listActiveRuns();
        return {
          state: active.length > 0 ? "active-campaigns" : "idle",
          // Safe per-repository summaries only: ids and loop state, never goals or errors.
          activeCampaigns: active.map((run) => ({
            repositoryId: run.repositoryId,
            runId: run.id,
            loopState: run.status
          })),
          pid: deps.identityPid
        };
      }
    );

    fastify.post<{ Body: { drain?: boolean }; Reply: Record<string, unknown> }>(
      "/api/system/shutdown",
      async (request, reply) => {
        if (!authorize(request.headers)) {
          void reply.code(401);
          return reply.send({ error: "UNAUTHORIZED", message: "Missing or invalid control token." });
        }
        const active = deps.runStore.listActiveRuns();
        if (active.length > 0) {
          void reply.code(409);
          return reply.send({
            error: "SHUTDOWN_REFUSED_ACTIVE",
            message:
              "Controller has active campaigns; graceful shutdown refused to protect running work. " +
              "Stop campaigns first or request a drain.",
            state: "active-campaigns",
            activeCampaigns: active.map((run) => ({
              repositoryId: run.repositoryId,
              runId: run.id,
              loopState: run.status
            }))
          });
        }
        // Idle: acknowledge, then tear down exactly like SIGTERM (fastify close
        // -> DB close -> lock release -> exit). The response lands before exit.
        setImmediate(() => deps.control?.requestShutdown("CONTROL_SHUTDOWN"));
        return { accepted: true, state: "shutting-down" };
      }
    );
  };
}
