import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import type { ApiErrorEnvelope } from "@orca/shared";

export async function registerStaticUi(
  fastify: FastifyInstance,
  uiDistDir: string | null
): Promise<void> {
  if (!uiDistDir || !fs.existsSync(uiDistDir)) {
    return;
  }

  const indexPath = path.join(uiDistDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return;
  }

  await fastify.register(fastifyStatic, {
    root: uiDistDir,
    prefix: "/",
    wildcard: false,
    index: "index.html"
  });

  // SPA fallback for non-API routes
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) {
      const errResponse: ApiErrorEnvelope = {
        error: {
          code: "REPOSITORY_NOT_FOUND",
          message: `API route ${request.method} ${request.url} not found.`
        }
      };
      return reply.status(404).send(errResponse);
    }

    return reply.sendFile("index.html");
  });
}
