import type { FastifyPluginAsync } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { TailscaleGuidance } from "@orca/shared";
import type { ControllerIdentity, ControllerIdentityResponse, SystemReadinessResponse } from "@orca/shared";
import { detectTailscaleStatus } from "../../tailscale/status.js";
import { getChromiumStatus } from "../../browser/provisioning.js";
import { buildSystemReadiness } from "../../runtime/readiness-service.js";
import type { BrowserManager } from "../../browser/browser-manager.js";
import type { RepositoryStore } from "../../repositories/repository-store.js";

export interface SystemRouteDeps {
  port: number;
  identity: ControllerIdentity;
  dataDir: string;
  db: DatabaseSync;
  repositoryStore: RepositoryStore;
  browserManager?: BrowserManager;
}

export const systemRoutes = (deps: SystemRouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { tailscale: TailscaleGuidance } }>(
      "/api/system/tailscale",
      async () => {
        const guidance = await detectTailscaleStatus(deps.port);
        return { tailscale: guidance };
      }
    );

    fastify.get("/api/system/provisioning", async () => {
      const chromium = deps.browserManager
        ? await deps.browserManager.getProvisioningStatus()
        : await getChromiumStatus();
      return { chromium };
    });

    fastify.get<{ Reply: ControllerIdentityResponse }>("/api/system/identity", async () => {
      return {
        identity: deps.identity,
        // Safe: the canonical writable data directory contains no secrets itself.
        dataDir: deps.dataDir
      };
    });

    fastify.get<{ Reply: SystemReadinessResponse }>("/api/system/readiness", async () => {
      return buildSystemReadiness({
        identity: deps.identity,
        dataDir: deps.dataDir,
        port: deps.port,
        db: deps.db,
        repositoryStore: deps.repositoryStore,
        browserManager: deps.browserManager ?? null
      });
    });
  };
};
