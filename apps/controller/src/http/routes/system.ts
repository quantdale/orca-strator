import type { FastifyPluginAsync } from "fastify";
import type { TailscaleGuidance } from "@orca/shared";
import { detectTailscaleStatus } from "../../tailscale/status.js";
import { getChromiumStatus } from "../../browser/provisioning.js";
import type { BrowserManager } from "../../browser/browser-manager.js";

export const systemRoutes = (port: number, browserManager?: BrowserManager): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { tailscale: TailscaleGuidance } }>(
      "/api/system/tailscale",
      async () => {
        const guidance = await detectTailscaleStatus(port);
        return { tailscale: guidance };
      }
    );

    fastify.get("/api/system/provisioning", async () => {
      const chromium = browserManager ? await browserManager.getProvisioningStatus() : await getChromiumStatus();
      return { chromium };
    });
  };
};
