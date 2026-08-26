import type { FastifyPluginAsync } from "fastify";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { TailscaleGuidance } from "@orca/shared";
import { DomainError } from "@orca/shared";
import type { ControllerIdentity, ControllerIdentityResponse, SystemReadinessResponse } from "@orca/shared";
import { detectTailscaleStatus } from "../../tailscale/status.js";
import { getChromiumStatus } from "../../browser/provisioning.js";
import { buildSystemReadiness } from "../../runtime/readiness-service.js";
import type { BackupManifest } from "../../runtime/state-backup.js";
import { createStateBackup, StateBackupError } from "../../runtime/state-backup.js";
import type { BrowserManager } from "../../browser/browser-manager.js";
import type { RepositoryStore } from "../../repositories/repository-store.js";

export interface SystemRouteDeps {
  port: number;
  identity: ControllerIdentity;
  dataDir: string;
  dbPath: string;
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

    // Change 026 §5 Settings Create-Backup action. The CONTROLLER owns durable
    // state, so the bundle is written server-side under the Orca data dir —
    // the renderer supplies no paths and gains no filesystem authority. This
    // also makes the same action work from a browser/phone origin through the
    // single loopback web surface. VACUUM INTO keeps the image consistent on
    // the live WAL database; structural exclusions hold by construction.
    fastify.post<{
      Reply: { bundleDir: string; manifest: BackupManifest };
    }>("/api/system/backup", async (_request, reply) => {
      try {
        const created = createStateBackup({
          dbPath: deps.dbPath,
          outDir: path.join(deps.dataDir, "backups", "manual"),
          applicationVersion: deps.identity.version,
        });
        return reply.status(201).send({
          bundleDir: created.bundleDir,
          manifest: created.manifest,
        });
      } catch (err) {
        if (err instanceof StateBackupError) {
          throw new DomainError(
            "BACKUP_FAILED",
            `State backup failed (${err.reason}): ${err.message}`,
            500,
          );
        }
        throw err;
      }
    });
  };
};
