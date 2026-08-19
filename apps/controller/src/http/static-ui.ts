import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import type { ApiErrorEnvelope } from "@orca/shared";

export async function registerStaticUi(
  fastify: FastifyInstance,
  uiDistDir: string | null
): Promise<void> {
  const hasUi = Boolean(
    uiDistDir &&
      fs.existsSync(uiDistDir) &&
      fs.existsSync(path.join(uiDistDir, "index.html"))
  );

  if (hasUi && uiDistDir) {
    await fastify.register(fastifyStatic, {
      root: uiDistDir,
      prefix: "/",
      wildcard: false,
      index: "index.html"
    });
  }

  // SPA fallback for non-API routes, structured JSON for unknown /api/* routes
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) {
      const errResponse: ApiErrorEnvelope = {
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `API route ${request.method} ${request.url} not found.`
        }
      };
      return reply.status(404).send(errResponse);
    }

    if (hasUi) {
      return reply.sendFile("index.html");
    }

    const errResponse: ApiErrorEnvelope = {
      error: {
        code: "ROUTE_NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found.`
      }
    };
    return reply.status(404).send(errResponse);
  });
}
