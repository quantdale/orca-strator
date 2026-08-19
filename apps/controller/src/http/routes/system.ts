import type { FastifyPluginAsync } from "fastify";
import type { TailscaleGuidance } from "@orca/shared";

export const systemRoutes = (port: number): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get<{ Reply: { tailscale: TailscaleGuidance } }>(
      "/api/system/tailscale",
      async () => {
        const loopbackUrl = `http://127.0.0.1:${port}`;
        const command = `tailscale serve --bg https / ${loopbackUrl}`;

        const guidance: TailscaleGuidance = {
          loopbackPort: port,
          loopbackUrl,
          command,
          status: "configured",
          instructions: [
            "1. Ensure Tailscale is running on your Windows host.",
            `2. Run PowerShell as Administrator: \`${command}\``,
            "3. Open your Tailscale machine HTTPS URL on your phone browser to access Orca-Strator securely."
          ]
        };

        return { tailscale: guidance };
      }
    );
  };
};
