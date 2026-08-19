import { loadConfig } from "./config/load-config.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const { fastify, dbContext } = await buildApp(config);

  const cleanup = async () => {
    fastify.log.info("Shutting down controller...");
    await fastify.close();
    dbContext.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await fastify.listen({ host: config.host, port: config.port });
    fastify.log.info(`Orca Controller listening on http://${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err, "Failed to start controller");
    dbContext.close();
    process.exit(1);
  }
}

main();
