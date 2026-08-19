import type { FastifyPluginAsync } from "fastify";
import type { TailscaleGuidance } from "@orca/shared";
import { detectTailscaleStatus } from "../../tailscale/status.js";

export const systemRoutes = (port: number): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { tailscale: TailscaleGuidance } }>(
      "/api/system/tailscale",
      async () => {
        const guidance = await detectTailscaleStatus(port);
        return { tailscale: guidance };
      }
    );
  };
};
